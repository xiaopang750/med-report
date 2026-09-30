/** Runs only in an isolated subprocess with global fetch replaced before analysis. */
import assert from "node:assert/strict";
import { createPreview, analyze } from "../server/ai";
import { get, put } from "../server/db";
import type { AppConfig, Preview, Report } from "../server/types";

const config: AppConfig = {
  mode: "live",
  model: "test-model",
  domain: "检验报告",
  diseaseContext: "血糖",
};
const report: Report = {
  id: "synthetic-protocol-report",
  filename: "synthetic.txt",
  mime: "text/plain",
  size: 42,
  source: "upload",
  status: "ready",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  text: "Name: Synthetic Example\nGlucose 6.2 mmol/L 3.9-6.1",
  anchors: [
    {
      id: "p1-l1",
      page: 1,
      line: 1,
      text: "Name: Synthetic Example",
      method: "text",
    },
    {
      id: "p1-l2",
      page: 1,
      line: 2,
      text: "Glucose 6.2 mmol/L 3.9-6.1",
      method: "text",
    },
  ],
  candidates: [
    {
      id: "c1",
      label: "Glucose",
      value: 6.2,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 6.1, text: "3.9-6.1" },
      anchorIds: ["p1-l2"],
      confidence: "high",
      status: "high",
      reason: "Synthetic fixture",
      source: "extracted",
    },
  ],
  annotations: [],
  warnings: [],
  analysis: null,
  history: [],
  candidateCount: 1,
  warningCount: 0,
};
const results: { name: string; ok: boolean; error?: string }[] = [];
let requests: any[] = [];
let offered: unknown = { findings: [] };
let responseText: string | undefined;
let responseStatus = 200;
globalThis.fetch = (async (_url: any, init: any) => {
  requests.push({ url: String(_url), init, payload: JSON.parse(init.body) });
  return new Response(
    responseText ??
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(offered) } }],
      }),
    { status: responseStatus },
  );
}) as typeof fetch;
const run = async (name: string, body: () => Promise<void>) => {
  try {
    await body();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: String(error) });
  }
};
const preview = () => createPreview(report, config, ["p1-l1", "p1-l2"]);
const request = (p: ReturnType<typeof preview>) => ({
  previewId: p.previewId,
  consent: true,
  anchorIds: ["p1-l1", "p1-l2"],
});

await run(
  "GLM-5.3 preview matches the transmitted thinking-enabled payload",
  async () => {
    const cfg = { ...config, model: "glm-5.3" };
    const p = createPreview(report, cfg, ["p1-l1", "p1-l2"]);
    await analyze(report, cfg, request(p));
    const payload = requests.at(-1)!.payload;
    assert.deepEqual(payload, p.payload);
    assert.equal(payload.model, "glm-5.3");
    assert.deepEqual(payload.thinking, { type: "enabled" });
    assert.equal(payload.reasoning_effort, "low");
    assert.equal(payload.max_tokens, 8192);
  },
);
await run(
  "transmits only the previewed minimized payload and never identifier-only lines",
  async () => {
    offered = {
      findings: [{ text: "空腹血糖：6.2 mmol/L", anchorIds: ["p1-l2"] }],
    };
    const p = preview();
    const analysis = await analyze(report, config, request(p));
    assert.equal(analysis.mode, "live");
    assert.equal(analysis.findings.length, 1);
    assert.ok(requests.length > 0);
    const sent = requests.at(-1)!;
    assert.deepEqual(sent.payload, p.payload);
    assert.equal(sent.init.redirect, "error");
    assert.equal(
      JSON.stringify(sent.payload).includes("Synthetic Example"),
      false,
    );
    assert.equal(JSON.stringify(sent.payload).includes("Name:"), false);
    await assert.rejects(
      () => analyze(report, config, request(p)),
      /Preview not found/i,
    );
  },
);
await run(
  "invalid citations and diagnostic or treatment instructions are not accepted",
  async () => {
    offered = {
      findings: [
        { text: "Unsupported statement", anchorIds: ["p999-l999"] },
        {
          text: "You have diabetes; treatment is required.",
          anchorIds: ["p1-l2"],
        },
        { text: "确诊糖尿病并服用药物", anchorIds: ["p1-l2"] },
        { text: "Empty references", anchorIds: [] },
        { text: "空腹血糖：6.2 mmol/L", anchorIds: ["p1-l2"] },
      ],
    };
    const p = preview();
    const analysis = await analyze(report, config, request(p));
    assert.equal(analysis.findings.length, 1);
    assert.deepEqual(analysis.findings[0]!.anchorIds, ["p1-l2"]);
    assert.ok(analysis.limitations.length >= 4);
  },
);
await run(
  "invented measurement values with real citations are rejected or explicitly uncertain",
  async () => {
    offered = {
      findings: [
        {
          text: "空腹血糖为9000 mmol/L，参考范围为100-200",
          anchorIds: ["p1-l2"],
        },
      ],
    };
    const p = preview();
    const analysis = await analyze(report, config, request(p));
    assert.ok(
      analysis.findings.length === 0 ||
        analysis.findings.every((f) =>
          /uncertain|不确定|未验证|无法验证|无法核验|不能核验/i.test(f.text),
        ),
      "An invented value with a valid citation was accepted as a factual finding",
    );
  },
);
await run("expired previews fail before any network transmission", async () => {
  const p = preview();
  const stored = get<Preview>("previews", p.previewId)!;
  put("previews", stored.id, {
    ...stored,
    expiresAt: "2000-01-01T00:00:00.000Z",
  });
  const prior = requests.length;
  await assert.rejects(() => analyze(report, config, request(p)), /expired/i);
  assert.equal(requests.length, prior);
});
await run(
  "malformed model JSON is rejected and response text is not exposed in errors",
  async () => {
    responseText = "SENSITIVE-MODEL-RESPONSE-not-json";
    const p = preview();
    try {
      await analyze(report, config, request(p));
      assert.fail("Invalid JSON should reject");
    } catch (error) {
      assert.match(String(error), /unsupported output/i);
      assert.equal(String(error).includes("SENSITIVE-MODEL-RESPONSE"), false);
    }
    responseText = undefined;
  },
);
await run(
  "provider errors do not expose private provider response bodies",
  async () => {
    responseText = "SENSITIVE-PROVIDER-ERROR";
    responseStatus = 429;
    const p = preview();
    try {
      await analyze(report, config, request(p));
      assert.fail("Provider error should reject");
    } catch (error) {
      assert.match(String(error), /HTTP 429/);
      assert.equal(String(error).includes("SENSITIVE-PROVIDER-ERROR"), false);
    }
    responseText = undefined;
    responseStatus = 200;
  },
);
process.stdout.write(JSON.stringify(results));
