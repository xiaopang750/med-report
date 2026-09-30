import { describe, expect, test } from "bun:test";
import {
  evaluateCandidates,
  extractCandidates,
  mergeAnnotations,
} from "../server/evaluate";
import { verifyUpload } from "../server/extract";
import type {
  Anchor,
  Annotation,
  Candidate,
  Rule,
  Status,
} from "../server/types";

const source: Anchor = {
  id: "p1-l1",
  page: 1,
  line: 1,
  text: "Glucose 6.2 mmol/L 3.9-6.1",
  method: "text",
};
const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "c-test",
  label: "Glucose",
  value: 6.2,
  unit: "mmol/L",
  referenceRange: { low: 3.9, high: 6.1, text: "3.9-6.1" },
  anchorIds: [source.id],
  confidence: "high",
  status: "uncertain",
  reason: "",
  source: "extracted",
  ...overrides,
});
const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "r-test",
  name: "Synthetic range",
  label: "Glucose",
  aliases: [],
  kind: "range",
  unit: "mmol/L",
  low: 3.9,
  high: 6.1,
  normalValues: [],
  abnormalValues: [],
  enabled: true,
  domain: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});
const evaluate = (
  item: Candidate,
  rules: Rule[] = [],
  anchors: Anchor[] = [source],
) => evaluateCandidates([item], rules, "test-domain", anchors)[0]!;

describe("conservative rule evaluation", () => {
  test.each([
    [3.8, "low"],
    [3.9, "normal"],
    [5, "normal"],
    [6.1, "normal"],
    [6.2, "high"],
  ])("explicit source interval boundary %s is %s", (value, status) => {
    expect(evaluate(candidate({ value: value as number })).status).toBe(
      status as Status,
    );
  });
  test("does not infer normality from absent value, range or units", () => {
    expect(evaluate(candidate({ value: null })).status).toBe("uncertain");
    expect(evaluate(candidate({ referenceRange: null })).status).toBe(
      "uncertain",
    );
    expect(evaluate(candidate({ unit: "" })).status).toBe("uncertain");
    expect(evaluate(candidate({ unit: "widgets" })).status).toBe("uncertain");
    expect(
      evaluate(candidate({ referenceRange: { low: 8, high: 1, text: "8-1" } }))
        .status,
    ).toBe("uncertain");
  });
  test("does not automatically convert between mismatched measurement units", () => {
    expect(evaluate(candidate({ unit: "mg/dL" }), [rule()]).status).toBe(
      "uncertain",
    );
    expect(evaluate(candidate(), [rule({ unit: "mg/dL" })]).status).toBe(
      "uncertain",
    );
  });
  test("requires review of all OCR-derived values until manually annotated", () => {
    expect(
      evaluate(
        candidate({ value: 4 }),
        [rule()],
        [{ ...source, method: "ocr" }],
      ).status,
    ).toBe("uncertain");
    expect(
      evaluate(
        candidate({ value: 4, source: "manual" }),
        [rule()],
        [{ ...source, method: "ocr" }],
      ).status,
    ).toBe("normal");
  });
  test("does not treat strict inequality values or reference limits as inclusive", () => {
    expect(evaluate(candidate({ value: "<6.1" }), [rule()]).status).toBe(
      "uncertain",
    );
    expect(
      evaluate(
        candidate({ value: 6.1, referenceRange: { high: 6.1, text: "<6.1" } }),
      ).status,
    ).toBe("uncertain");
    expect(
      evaluate(
        candidate({ value: 6.1, referenceRange: { high: 6.1, text: "<=6.1" } }),
      ).status,
    ).toBe("normal");
  });
  test("ambiguous duplicate rules cannot silently override each other", () => {
    expect(
      evaluate(candidate(), [rule(), rule({ id: "r-other", high: 100 })])
        .status,
    ).toBe("uncertain");
  });
  test("disabled and different-domain rules cannot classify a result", () => {
    const noReference = candidate({ referenceRange: null });
    expect(evaluate(noReference, [rule({ enabled: false })]).status).toBe(
      "uncertain",
    );
    expect(
      evaluate(noReference, [rule({ domain: "unrelated-domain" })]).status,
    ).toBe("uncertain");
  });
  test("overlapping normalized qualitative classifications stay uncertain for legacy rules", () => {
    const conflicting = rule({
      kind: "qualitative",
      unit: "",
      low: undefined,
      high: undefined,
      normalValues: ["negative"],
      abnormalValues: [" NEGATIVE "],
    });
    expect(
      evaluate(
        candidate({ value: "negative", unit: "", referenceRange: null }),
        [conflicting],
      ).status,
    ).toBe("uncertain");
  });
  test.each([
    ["negative", "normal"],
    ["positive", "abnormal"],
    ["pending", "uncertain"],
    [3, "uncertain"],
  ])("qualitative %s is %s", (value, status) => {
    expect(
      evaluate(
        candidate({
          value: value as string | number,
          unit: "",
          referenceRange: null,
        }),
        [
          rule({
            kind: "qualitative",
            unit: "",
            low: undefined,
            high: undefined,
            normalValues: ["negative"],
            abnormalValues: ["positive"],
          }),
        ],
      ).status,
    ).toBe(status as Status);
  });
});

describe("evidence-grounded extraction", () => {
  test("extracts numeric values and explicit reference ranges without including identity fields", () => {
    const items = extractCandidates([
      source,
      { ...source, id: "p1-l2", line: 2, text: "Name: Synthetic Example" },
      { ...source, id: "p1-l3", line: 3, text: "Patient ID: 12345" },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]!.value).toBe(6.2);
    expect(items[0]!.unit).toBe("mmol/L");
    expect(items[0]!.referenceRange?.low).toBe(3.9);
    expect(items[0]!.anchorIds).toEqual(["p1-l1"]);
  });
  test("does not infer fasting status from generic English or Chinese glucose labels", () => {
    for (const text of [
      "Glucose 6.2 mmol/L 3.9-6.1",
      "葡萄糖 6.2 mmol/L 3.9-6.1",
      "葡 萄 糖 6.2 mmol/L 3.9-6.1",
    ]) {
      const item = extractCandidates([{ ...source, text }])[0]!;
      expect(item.label).toBe("血糖");
      expect(item.label).not.toContain("空腹");
    }
    expect(
      extractCandidates([
        { ...source, text: "空腹葡萄糖 6.2 mmol/L 3.9-6.1" },
      ])[0]!.label,
    ).toBe("空腹血糖");
  });
  test("keeps urea distinct from urea nitrogen and CRP distinct from high-sensitivity CRP", () => {
    const examples: [string, string][] = [
      ["Urea 5.0 mmol/L 2.5-7.1", "尿素"],
      ["BUN 5.0 mmol/L 2.5-7.1", "尿素氮"],
      ["CRP 2 mg/L 0-5", "C反应蛋白"],
      ["hs-CRP 2 mg/L 0-5", "超敏C反应蛋白"],
    ];
    for (const [text, label] of examples)
      expect(extractCandidates([{ ...source, text }])[0]!.label).toBe(label);
  });
  test("retains qualified numbers and qualitative values for explicit review", () => {
    const items = extractCandidates([
      { ...source, text: "Glucose <6.1 mmol/L 3.9-6.1" },
      { ...source, id: "p1-l2", text: "Protein negative" },
    ]);
    expect(items[0]!.value).toBe("<6.1");
    expect(items[1]!.value).toBe("negative");
    expect(items[1]!.unit).toBe("");
  });
  test("manual annotation replaces matching extracted evidence only", () => {
    const a: Annotation = {
      id: "a-test",
      anchorId: source.id,
      label: "Glucose",
      value: 4.5,
      unit: "mmol/L",
      note: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const merged = mergeAnnotations(
      [candidate(), candidate({ id: "c-other", anchorIds: ["p1-l2"] })],
      [a],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.source === "manual")?.value).toBe(4.5);
    expect(merged.find((c) => c.id === "c-other")).toBeDefined();
    expect(source.text).toBe("Glucose 6.2 mmol/L 3.9-6.1");
  });
});

describe("upload sniffing and bounded inputs", () => {
  test("accepts supported synthetic bytes based on extension and signature", async () => {
    for (const name of [
      "synthetic-report.txt",
      "synthetic-text.pdf",
      "synthetic-table.docx",
      "synthetic-scan.png",
    ]) {
      expect(
        verifyUpload(
          name,
          new Uint8Array(
            await Bun.file(
              `${import.meta.dir}/../fixtures/${name}`,
            ).arrayBuffer(),
          ),
        ).extension,
      ).toBe(name.split(".").at(-1)!);
    }
  });
  test("rejects empty bytes, wrong signatures, embedded null text and executable uploads", () => {
    expect(() => verifyUpload("empty.txt", new Uint8Array())).toThrow();
    expect(() =>
      verifyUpload("fake.pdf", new TextEncoder().encode("not PDF")),
    ).toThrow();
    expect(() =>
      verifyUpload("fake.txt", new Uint8Array([65, 0, 66])),
    ).toThrow();
    expect(() =>
      verifyUpload("shell.sh", new TextEncoder().encode("#!/bin/sh")),
    ).toThrow();
    expect(() =>
      verifyUpload("fake.docx", new TextEncoder().encode("not ZIP")),
    ).toThrow();
  });
  test("rejects a PNG claiming decompression-bomb dimensions before invoking OCR", () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    bytes.writeUInt32BE(50_000, 16);
    bytes.writeUInt32BE(50_000, 20);
    expect(() => verifyUpload("bomb.png", bytes)).toThrow();
  });
});
