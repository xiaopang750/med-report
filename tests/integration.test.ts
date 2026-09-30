import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";

// Every fixture is fabricated. Test processes have isolated storage, a deliberately
// unusable AI endpoint and a dummy key. No external AI call is permitted.
const ROOT = resolve(import.meta.dir, "..");
const FIXTURES = join(ROOT, "fixtures");
const KEY_SENTINEL = "test-only-never-use-secret-sentinel-8492";
const INVALID_ENDPOINT = "http://127.0.0.1:1/forbidden-network-test";
const TEST_ROOT = mkdtempSync(join(tmpdir(), "report-studio-tests-"));
let server: Subprocess | undefined;
let base = "";
let serverOutput = "";
let health: any;
let sessionCookie = "";
let report: any;
let templateId = "";
let annotationId = "";
const hasChineseOcr =
  !!Bun.which("tesseract") &&
  Bun.spawnSync(["tesseract", "--list-langs"])
    .stdout.toString()
    .includes("chi_sim");
const ruleIds: string[] = [];

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (sessionCookie) headers.set("cookie", sessionCookie);
  if (init.body && !(init.body instanceof FormData))
    headers.set("content-type", "application/json");
  const response = await fetch(`${base}/api${path}`, { ...init, headers });
  const body = await response.text();
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    data = body;
  }
  return { response, data, body };
}
async function ok(path: string, method = "GET", body?: any) {
  const result = await api(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!result.response.ok)
    throw new Error(
      `${method} ${path}: ${result.response.status} ${result.body}`,
    );
  return result.data;
}
async function reject(path: string, method: string, body?: any) {
  const result = await api(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(result.response.status).toBeGreaterThanOrEqual(400);
  expect(result.response.status).toBeLessThan(500);
  expect(result.data).toHaveProperty("error");
  expect(result.data).toHaveProperty("code");
  return result;
}
async function waitForReport(uploaded: any, timeoutMs = 60_000) {
  let item = uploaded.report ?? uploaded;
  expect(item.id).toBeString();
  const deadline = Date.now() + timeoutMs;
  while (["queued", "processing", "extracting"].includes(item.status)) {
    if (Date.now() > deadline)
      throw new Error(
        `Extraction timeout for ${item.id}: ${JSON.stringify(item)}`,
      );
    await Bun.sleep(100);
    item = await ok(`/reports/${item.id}`);
  }
  return item;
}
async function upload(name: string, mime?: string, filename?: string) {
  const form = new FormData();
  const bytes = readFileSync(join(FIXTURES, name));
  form.set(
    "file",
    new File([bytes], filename ?? name, {
      type: mime ?? "application/octet-stream",
    }),
  );
  const result = await api("/reports", { method: "POST", body: form });
  if (!result.response.ok)
    throw new Error(`Upload ${name}: ${result.response.status} ${result.body}`);
  return waitForReport(result.data);
}
async function annotate(
  label: string,
  value: number | string,
  unit = "",
  extra: object = {},
) {
  report = await ok(`/reports/${report.id}/annotations`, "POST", {
    anchorId:
      report.anchors.find((x: any) => x.text.includes("Glucose"))?.id ??
      report.anchors[0].id,
    label,
    value,
    unit,
    ...extra,
  });
  return report.candidates.find(
    (x: any) => x.label === label && x.source === "manual",
  );
}
async function createRule(label: string, extras: object = {}) {
  const item = await ok("/rules", "POST", {
    name: `Test ${label}`,
    label,
    aliases: [],
    kind: "numeric",
    low: 3,
    high: 6,
    unit: "mmol/L",
    ...extras,
  });
  ruleIds.push(item.id);
  return item;
}
function recursiveFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? recursiveFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

beforeAll(async () => {
  // Bind once to let the OS choose a free port; close before starting the real app.
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("port probe"),
  });
  const port = probe.port;
  probe.stop(true);
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: join(TEST_ROOT, "data"),
      FILE_DIR: join(TEST_ROOT, "file"),
      LOG_DIR: join(TEST_ROOT, "logs"),
      GLM_API_KEY: KEY_SENTINEL,
      GLM_ENDPOINT: INVALID_ENDPOINT,
      AI_MODE: "mock",
      GLM_MODEL: "",
      APP_TOKEN: "",
      APP_ORIGIN: base,
      OCR_CONCURRENCY: "1",
      OCR_THREADS: "1",
      MAX_UPLOAD_MB: "2",
      WORKER_CONCURRENCY: "1",
      MAX_QUEUE: "4",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  void new Response(server.stdout as ReadableStream<Uint8Array>)
    .text()
    .then((text) => {
      serverOutput += text;
    });
  void new Response(server.stderr as ReadableStream<Uint8Array>)
    .text()
    .then((text) => {
      serverOutput += text;
    });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await api("/health");
      if (result.response.ok) {
        health = result.data;
        const login = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ username: "admin", password: "admin" }),
        });
        if (!login.response.ok) throw new Error("Demo login failed");
        sessionCookie = login.response.headers
          .get("set-cookie")!
          .split(";")[0]!;
        return;
      }
    } catch {
      /* server is starting */
    }
    if (server.exitCode !== null)
      throw new Error(`Test server exited: ${serverOutput}`);
    await Bun.sleep(100);
  }
  throw new Error(`Test server did not become ready: ${serverOutput}`);
}, 35_000);

afterAll(async () => {
  server?.kill();
  if (server) await Promise.race([server.exited, Bun.sleep(5000)]);
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("local ingestion and stable evidence", () => {
  test("default deployment without APP_TOKEN still requires a browser session", async () => {
    expect((await fetch(`${base}/api/reports`)).status).toBe(401);
    expect((await fetch(`${base}/api/config`)).status).toBe(401);
    expect((await api("/reports")).response.ok).toBe(true);
  });
  test("health discloses runtime capability and default is mock", async () => {
    expect(health.ok).toBe(true);
    expect((await ok("/config")).model).toBe("glm-5.3");
    expect(health.capabilities).toHaveProperty("pdftotext");
    expect(health.capabilities).toHaveProperty("tesseract");
    const cfg = await ok("/config");
    expect(cfg.mode).toBe("mock");
    expect(cfg.privacyWarning).toBeString();
    expect(JSON.stringify(cfg)).not.toContain(KEY_SENTINEL);
    expect(cfg).not.toHaveProperty("key");
    expect(cfg).not.toHaveProperty("apiKey");
  });

  test("uploads and extracts a UTF-8 report entirely locally", async () => {
    report = await upload("synthetic-report.txt", "text/plain");
    expect(["ready", "needs_review"]).toContain(report.status);
    expect(report.text).toContain("Glucose");
    expect(report.text).toContain("6.2");
    expect(report.anchors.length).toBeGreaterThan(5);
    expect(new Set(report.anchors.map((a: any) => a.id)).size).toBe(
      report.anchors.length,
    );
    for (const candidate of report.candidates) {
      expect(candidate.anchorIds.length).toBeGreaterThan(0);
      expect(
        candidate.anchorIds.every((id: string) =>
          report.anchors.some((a: any) => a.id === id),
        ),
      ).toBe(true);
    }
    expect(report).not.toHaveProperty("storedPath");
    const reread = await ok(`/reports/${report.id}`);
    expect(reread.anchors).toEqual(report.anchors);
    const job = await ok(`/jobs/${report.job.id}`);
    expect(job.reportId).toBe(report.id);
    expect(job.status).toBe("complete");
  });

  test("extracts a DOCX native table", async () => {
    const item = await upload(
      "synthetic-table.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(["ready", "needs_review"]).toContain(item.status);
    expect(item.text).toContain("Glucose");
    expect(item.text).toContain("6.2");
    expect(item.text).toContain("Hemoglobin");
    expect(item.anchors.some((a: any) => a.method === "docx")).toBe(true);
    expect(
      item.candidates.some((c: any) => c.value === 6.2 && c.unit === "mmol/L"),
    ).toBe(true);
  }, 60_000);

  test.skipIf(!Bun.which("pdftotext"))(
    "extracts a two-page text PDF with page anchors",
    async () => {
      const item = await upload("synthetic-text.pdf", "application/pdf");
      expect(["ready", "needs_review"]).toContain(item.status);
      expect(item.text).toContain("Glucose");
      expect(item.text).toContain("Sodium");
      expect(item.anchors.some((a: any) => a.page === 2)).toBe(true);
      expect(item.anchors.some((a: any) => a.method === "text")).toBe(true);
    },
    60_000,
  );

  test.skipIf(!Bun.which("tesseract"))(
    "extracts a PNG using local English OCR",
    async () => {
      const item = await upload("synthetic-scan.png", "image/png");
      expect(["ready", "needs_review"]).toContain(item.status);
      expect(item.text.toLowerCase()).toContain("glucose");
      expect(item.anchors.some((a: any) => a.method === "ocr")).toBe(true);
      expect(item.warnings.length).toBeGreaterThan(0);
    },
    90_000,
  );

  test.skipIf(!hasChineseOcr)(
    "extracts a Chinese PNG using local chi_sim OCR",
    async () => {
      const item = await upload("synthetic-chinese-scan.png", "image/png");
      expect(["ready", "needs_review"]).toContain(item.status);
      expect(item.text.replace(/\s/g, "")).toContain("葡萄糖");
      expect(item.text).toContain("6.2");
      expect(item.anchors.some((a: any) => a.method === "ocr")).toBe(true);
      const glucose = item.candidates.find(
        (c: any) => c.label === "血糖" && c.value === 6.2,
      );
      expect(glucose).toBeDefined();
      expect(glucose.status).toBe("uncertain");
      const preview = await ok(`/reports/${item.id}/ai-preview`, "POST", {
        anchorIds: glucose.anchorIds,
      });
      expect(preview.excerpts.some((e: any) => /6\.2/.test(e.text))).toBe(true);
    },
    90_000,
  );

  test.skipIf(!Bun.which("tesseract") || !Bun.which("pdftoppm"))(
    "extracts an image-only PDF using rasterization and OCR",
    async () => {
      const item = await upload("synthetic-scan.pdf", "application/pdf");
      expect(["ready", "needs_review"]).toContain(item.status);
      expect(item.text.toLowerCase()).toContain("glucose");
      expect(item.anchors.some((a: any) => a.method === "ocr")).toBe(true);
    },
    90_000,
  );
});

describe("annotations, extraction templates, and defensible rules", () => {
  test("rejects annotations on fabricated evidence anchors", async () => {
    await reject(`/reports/${report.id}/annotations`, "POST", {
      anchorId: "p999-l999",
      label: "Injected",
      value: 100,
    });
  });

  test("manual annotation preserves the original source and cites its anchor", async () => {
    const original = report.text;
    const candidate = await annotate("Manual Glucose", 6.2, "mmol/L", {
      referenceLow: 3.9,
      referenceHigh: 6.1,
      note: "Synthetic review note",
    });
    expect(report.text).toBe(original);
    expect(candidate).toBeDefined();
    expect(candidate.anchorIds).toContain(report.annotations.at(-1).anchorId);
    annotationId = report.annotations.at(-1).id;
    expect(report.annotations.at(-1).note).toBe("Synthetic review note");
  });

  test("rejects backwards reference bounds and malformed values", async () => {
    await reject(`/reports/${report.id}/annotations`, "POST", {
      anchorId: report.anchors[0].id,
      label: "Invalid",
      value: 3,
      referenceLow: 10,
      referenceHigh: 1,
    });
    await reject(`/reports/${report.id}/annotations`, "POST", {
      anchorId: report.anchors[0].id,
      label: "Invalid",
      value: { nested: 1 },
    });
  });

  test("template CRUD and applying aliases retain evidence links", async () => {
    const item = await ok("/templates", "POST", {
      name: "Synthetic chemistry",
      domain: "test",
      fields: [
        { label: "Test fasting glucose", aliases: ["Glucose"], unit: "mmol/L" },
      ],
    });
    templateId = item.id;
    expect(
      (await ok("/templates")).templates.some((t: any) => t.id === item.id),
    ).toBe(true);
    await ok(`/templates/${item.id}`, "PUT", {
      name: "Synthetic chemistry reviewed",
      domain: "test",
      fields: [
        { label: "Test fasting glucose", aliases: ["Glucose"], unit: "mmol/L" },
      ],
    });
    report = await ok(`/reports/${report.id}/apply-template`, "POST", {
      templateId: item.id,
    });
    const mapped = report.candidates.find(
      (c: any) => c.label === "Test fasting glucose",
    );
    expect(mapped).toBeDefined();
    expect(mapped.anchorIds.length).toBeGreaterThan(0);
    expect(report.annotations.some((a: any) => a.id === annotationId)).toBe(
      true,
    );
  });

  test("numeric thresholds are inclusive and units are required to match", async () => {
    await createRule("Threshold Value");
    await annotate("Threshold Value", 6, "mmol/L");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Threshold Value").status,
    ).toBe("normal");
    await annotate("Threshold Value", 6.1, "mmol/L");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Threshold Value").status,
    ).toBe("high");
    await annotate("Threshold Value", 2.9, "mmol/L");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Threshold Value").status,
    ).toBe("low");
    await annotate("Threshold Value", 7, "mystery-unit");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Threshold Value").status,
    ).toBe("uncertain");
    await annotate("Threshold Value", 7, "");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Threshold Value").status,
    ).toBe("uncertain");
  });

  test("range rule and qualitative rules give conservative unknown results", async () => {
    await createRule("Range Value", {
      kind: "range",
      low: 10,
      high: 20,
      unit: "g/L",
    });
    await annotate("Range Value", 15, "g/L");
    await createRule("Qualitative Value", {
      kind: "qualitative",
      low: undefined,
      high: undefined,
      unit: "",
      normalValues: ["negative"],
      abnormalValues: ["positive"],
    });
    await annotate("Qualitative Value", "negative");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Range Value").status,
    ).toBe("normal");
    expect(
      report.candidates.find((c: any) => c.label === "Qualitative Value")
        .status,
    ).toBe("normal");
    await annotate("Qualitative Value", "positive");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Qualitative Value")
        .status,
    ).toBe("abnormal");
    await annotate("Qualitative Value", "pending");
    report = await ok(`/reports/${report.id}/evaluate`, "POST");
    expect(
      report.candidates.find((c: any) => c.label === "Qualitative Value")
        .status,
    ).toBe("uncertain");
  });

  test("rejects normalized overlap between normal and abnormal qualitative values", async () => {
    const created = await reject("/rules", "POST", {
      name: "Conflicting qualitative rule",
      label: "Conflict",
      kind: "qualitative",
      unit: "",
      normalValues: ["negative"],
      abnormalValues: [" NEGATIVE "],
    });
    expect(created.response.status).toBe(400);
    const valid = await createRule("Qualitative edit conflict", {
      kind: "qualitative",
      low: undefined,
      high: undefined,
      unit: "",
      normalValues: ["negative"],
      abnormalValues: ["positive"],
    });
    const edited = await reject(`/rules/${valid.id}`, "PUT", {
      name: "Conflicting edit",
      label: valid.label,
      kind: "qualitative",
      unit: "",
      normalValues: ["positive"],
      abnormalValues: [" POSITIVE "],
    });
    expect(edited.response.status).toBe(400);
    const preserved = (await ok("/rules")).rules.find(
      (r: any) => r.id === valid.id,
    );
    expect(preserved.normalValues).toEqual(["negative"]);
    expect(preserved.abnormalValues).toEqual(["positive"]);
  });

  test("invalid and empty classification rules are rejected", async () => {
    await reject("/rules", "POST", {
      name: "Bad bounds",
      label: "Bad",
      kind: "numeric",
      unit: "x",
      low: 9,
      high: 1,
    });
    await reject("/rules", "POST", {
      name: "Bad kind",
      label: "Bad",
      kind: "diagnosis",
    });
  });
});

describe("AI preview, redaction and explicit consent", () => {
  let report: any;
  let preview: any;
  let selected: string[];

  test("rejects unknown preview anchors and drops identifying lines", async () => {
    report = await upload("synthetic-report.txt", "text/plain");
    await reject(`/reports/${report.id}/ai-preview`, "POST", {
      anchorIds: ["p999-l999"],
    });
    selected = report.anchors
      .filter((a: any) => /Name:|Phone:|Email:|Glucose/.test(a.text))
      .map((a: any) => a.id);
    preview = await ok(`/reports/${report.id}/ai-preview`, "POST", {
      anchorIds: selected,
    });
    expect(preview.mode).toBe("mock");
    expect(preview.previewId).toBeString();
    expect(Date.parse(preview.expiresAt)).toBeGreaterThan(Date.now());
    const excerptText = JSON.stringify(preview.excerpts);
    expect(excerptText).not.toContain("Synthetic Example");
    expect(excerptText).not.toContain("202-555-0199");
    expect(excerptText).not.toContain("synthetic@example.invalid");
    expect(
      preview.excerpts.some((x: any) => /6\.2.*mmol\/L/.test(x.text)),
    ).toBe(true);
    expect(
      preview.excerpts.every((x: any) => selected.includes(x.anchorId)),
    ).toBe(true);
  });

  test("does not run without explicit consent or without a stored preview", async () => {
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: preview.previewId,
      anchorIds: selected,
    });
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: preview.previewId,
      consent: false,
      anchorIds: selected,
    });
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: "invented-preview",
      consent: true,
      anchorIds: selected,
    });
  });

  test("rejects changed selection and arbitrary client text", async () => {
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: preview.previewId,
      consent: true,
      anchorIds: ["p999-l999"],
    });
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: preview.previewId,
      consent: true,
      anchorIds: selected,
      text: "DO NOT TRANSMIT: client-injected raw text",
    });
    await reject(`/reports/${report.id}/ai-preview`, "POST", {
      anchorIds: selected,
      text: "DO NOT TRANSMIT: client-injected raw text",
    });
  });

  test("mock analysis is clearly labeled and every finding cites selected evidence", async () => {
    report = await ok(`/reports/${report.id}/analyze`, "POST", {
      previewId: preview.previewId,
      consent: true,
      anchorIds: selected,
    });
    expect(report.analysis.mode).toBe("mock");
    expect(report.analysis.limitations.length).toBeGreaterThan(0);
    expect(report.analysis.summary).toBeString();
    for (const finding of report.analysis.findings) {
      expect(finding.anchorIds.length).toBeGreaterThan(0);
      expect(
        finding.anchorIds.every((id: string) => selected.includes(id)),
      ).toBe(true);
      expect(
        finding.anchorIds.every((id: string) =>
          preview.excerpts.some((e: any) => e.anchorId === id),
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(report.analysis)).not.toContain(KEY_SENTINEL);
    expect(JSON.stringify(report.analysis)).not.toContain("Synthetic Example");
  });

  test("preview is invalidated when source review changes", async () => {
    const p = await ok(`/reports/${report.id}/ai-preview`, "POST", {
      anchorIds: selected,
    });
    await Bun.sleep(2);
    report = await ok(`/reports/${report.id}/annotations`, "POST", {
      anchorId: selected.find((id) =>
        report.anchors.find((a: any) => a.id === id)?.text.includes("Glucose"),
      ),
      label: "Glucose",
      value: 6.3,
      unit: "mmol/L",
    });
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: p.previewId,
      consent: true,
      anchorIds: selected,
    });
  });

  test("preview is invalidated when analysis configuration changes", async () => {
    const p = await ok(`/reports/${report.id}/ai-preview`, "POST", {
      anchorIds: selected,
    });
    const cfg = await ok("/config");
    await ok("/config", "PUT", {
      diseaseContext: "Synthetic context changed for preview verification",
    });
    await reject(`/reports/${report.id}/analyze`, "POST", {
      previewId: p.previewId,
      consent: true,
      anchorIds: selected,
    });
    await ok("/config", "PUT", { diseaseContext: cfg.diseaseContext });
  });
});

describe("exports, audit, and HTTP security", () => {
  test("JSON and CSV exports are attachments and HTML is escaped", async () => {
    await annotate('<script>alert("fixture")</script>', "=1+1", "", {
      note: "<img src=x onerror=alert(1)>",
    });
    for (const format of ["json", "csv", "html"]) {
      const result = await api(`/reports/${report.id}/export?format=${format}`);
      expect(result.response.ok).toBe(true);
      expect(result.body).not.toContain(KEY_SENTINEL);
      if (format !== "html")
        expect(result.response.headers.get("content-disposition")).toContain(
          "attachment",
        );
      if (format === "json")
        expect(result.data).not.toHaveProperty("storedPath");
      if (format === "html") {
        expect(result.body).not.toContain('<script>alert("fixture")</script>');
        expect(result.body).not.toContain("<img src=x onerror=alert(1)>");
      }
      if (format === "csv")
        expect(result.body).not.toMatch(/(?:^|,)"?=1\+1(?:"?,|"?$)/m);
    }
  });

  test("history and log metadata do not expose source text or credentials", async () => {
    const result = await ok("/history");
    expect(result.history.length).toBeGreaterThan(0);
    const text = JSON.stringify(result);
    expect(text).not.toContain(KEY_SENTINEL);
    expect(text).not.toContain("Synthetic Example");
    expect(text).not.toContain("202-555-0199");
    expect(text).not.toContain("Glucose 6.2");
    const logFiles = recursiveFiles(join(TEST_ROOT, "logs"));
    for (const file of logFiles) {
      const logged = readFileSync(file, "utf8");
      expect(logged).not.toContain(KEY_SENTINEL);
      expect(logged).not.toContain("Synthetic Example");
      expect(logged).not.toContain("202-555-0199");
    }
  });

  test("config cannot accept API keys or arbitrary upstream endpoints", async () => {
    const old = await ok("/config");
    await reject("/config", "PUT", {
      apiKey: "malicious-key",
      endpoint: "https://evil.invalid",
    });
    const current = await ok("/config");
    expect(current.endpoint).toBe(old.endpoint);
    expect(JSON.stringify(current)).not.toContain("malicious-key");
    expect(JSON.stringify(current)).not.toContain(KEY_SENTINEL);
  });

  test("rejects attacker-controlled Host headers to prevent DNS rebinding", async () => {
    const result = await api("/config", {
      headers: { host: "attacker.invalid" },
    });
    expect(result.response.status).toBe(403);
  });

  test("rejects cross-origin browser mutation", async () => {
    const result = await api("/config", {
      method: "PUT",
      headers: { origin: "https://evil.invalid" },
      body: JSON.stringify({ diseaseContext: "unwanted mutation" }),
    });
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(result.response.status).toBeLessThan(500);
    expect((await ok("/config")).diseaseContext).not.toBe("unwanted mutation");
  });

  test("rejects missing, empty, disallowed and forged upload types", async () => {
    const missing = await api("/reports", {
      method: "POST",
      body: new FormData(),
    });
    expect(missing.response.status).toBeGreaterThanOrEqual(400);
    for (const [filename, content, type] of [
      ["empty.txt", "", "text/plain"],
      ["payload.html", "<script>bad</script>", "text/html"],
      ["forged.pdf", "not a real PDF", "application/pdf"],
    ]) {
      const form = new FormData();
      form.set("file", new File([content!], filename!, { type: type! }));
      const result = await api("/reports", { method: "POST", body: form });
      if (result.response.ok) {
        const item = await waitForReport(result.data);
        expect(item.status).toBe("error");
      } else {
        expect(result.response.status).toBeGreaterThanOrEqual(400);
        expect(result.response.status).toBeLessThan(500);
      }
    }
  });

  test("rejects oversized multipart uploads before extraction", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["x".repeat(3 * 1024 * 1024)], "oversized.txt", {
        type: "text/plain",
      }),
    );
    const result = await api("/reports", { method: "POST", body: form });
    expect(result.response.status).toBe(413);
  });

  test("rejects dangerous DOCX expansion ratios in the bounded extraction job", async () => {
    const item = await upload(
      "synthetic-expansion-limit.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(item.status).toBe("error");
    expect(item.warnings.join(" ")).toMatch(/expansion|complex|safe/i);
  });

  test.skipIf(!Bun.which("tesseract"))(
    "bounds concurrent OCR jobs and gives explicit backpressure",
    async () => {
      const bytes = readFileSync(join(FIXTURES, "synthetic-scan.png"));
      const previousFileCount = recursiveFiles(join(TEST_ROOT, "file")).length;
      const submitted = await Promise.all(
        Array.from({ length: 12 }, async (_, index) => {
          const form = new FormData();
          form.set(
            "file",
            new File([bytes], `queue-fixture-${index}.png`, {
              type: "image/png",
            }),
          );
          return api("/reports", { method: "POST", body: form });
        }),
      );
      const runtime = await ok("/health");
      expect(runtime.queue.active).toBeLessThanOrEqual(1);
      expect(runtime.queue.queued).toBeLessThanOrEqual(4);
      const accepted = submitted.filter((result) => result.response.ok);
      const refused = submitted.filter((result) => !result.response.ok);
      expect(accepted.length).toBeGreaterThan(0);
      expect(refused.length).toBeGreaterThan(0);
      for (const result of refused) expect(result.response.status).toBe(429);
      for (const result of accepted) {
        const done = await waitForReport(result.data, 90_000);
        expect(["ready", "needs_review"]).toContain(done.status);
        expect(done.job.status).toBe("complete");
      }
      expect(
        recursiveFiles(join(TEST_ROOT, "file")).length - previousFileCount,
      ).toBe(accepted.length);
    },
    120_000,
  );

  test("stored upload names do not permit path traversal", async () => {
    const item = await upload(
      "synthetic-report.txt",
      "text/plain",
      "../../outside-synthetic.txt",
    );
    expect(item).not.toHaveProperty("storedPath");
    const paths = recursiveFiles(join(TEST_ROOT, "file"));
    expect(paths.length).toBeGreaterThan(0);
    expect(
      paths.every((path) => path.startsWith(`${join(TEST_ROOT, "file")}/`)),
    ).toBe(true);
    expect(readdirSync(TEST_ROOT)).not.toContain("outside-synthetic.txt");
    for (const path of [
      "/reports/..%2F..%2Fetc%2Fpasswd",
      "/reports/not-a-real-id",
    ]) {
      const result = await api(path);
      expect(result.response.status).toBeGreaterThanOrEqual(400);
      expect(result.body).not.toContain("root:x:");
    }
  });

  test("serves local OpenAPI documentation", async () => {
    const spec = await ok("/openapi.json");
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths).toHaveProperty("/api/reports");
    const docs = await api("/docs");
    expect(docs.response.ok).toBe(true);
    expect(docs.body.toLowerCase()).toContain("swagger");
  });

  test("supports deleting test annotations, templates and rules", async () => {
    report = await ok(
      `/reports/${report.id}/annotations/${annotationId}`,
      "DELETE",
    );
    expect(report.annotations.some((a: any) => a.id === annotationId)).toBe(
      false,
    );
    await ok(`/templates/${templateId}`, "DELETE");
    expect(
      (await ok("/templates")).templates.some((t: any) => t.id === templateId),
    ).toBe(false);
    for (const id of ruleIds) await ok(`/rules/${id}`, "DELETE");
    const remaining = (await ok("/rules")).rules;
    expect(remaining.some((r: any) => ruleIds.includes(r.id))).toBe(false);
  });
});
