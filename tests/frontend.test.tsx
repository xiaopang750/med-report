import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { Window } from "happy-dom";
import type { Report, Template, Rule, Config } from "../src/types";

// Component-only DOM. These tests never open a browser or contact a provider.
const dom = new Window({ url: "http://localhost:5173" });
const globals = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "MutationObserver",
  "getComputedStyle",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const key of globals) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const source =
    key === "window"
      ? dom
      : key === "document"
        ? dom.document
        : (dom as any)[key];
  Object.defineProperty(globalThis, key, {
    value:
      typeof source === "function" &&
      [
        "getComputedStyle",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ].includes(key)
        ? source.bind(dom)
        : source,
    writable: true,
    configurable: true,
  });
}
(dom.HTMLElement.prototype as any).scrollIntoView = () => {};
const { render, screen, fireEvent, waitFor, cleanup, within } =
  await import("@testing-library/react");
const { default: App } = await import("../src/App");
const originalFetch = globalThis.fetch;
let calls: { path: string; method: string; body: any }[] = [];
let report: Report;
let config: Config;
let templates: Template[];
let rules: Rule[];
const now = "2026-09-30T07:00:00.000Z";
const reportFixture = (): Report => ({
  id: "test-report",
  filename: "研究血检.pdf",
  mime: "application/pdf",
  size: 24000,
  status: "ready",
  createdAt: now,
  updatedAt: now,
  source: "upload",
  text: "研究报告\n血糖 7.2 mmol/L 3.9–6.1\n尿蛋白 阴性",
  anchors: [
    { id: "p1-l1", page: 1, line: 1, text: "研究报告", method: "text" },
    {
      id: "p1-l2",
      page: 1,
      line: 2,
      text: "血糖 7.2 mmol/L 3.9–6.1",
      method: "text",
    },
    { id: "p1-l3", page: 1, line: 3, text: "尿蛋白 阴性", method: "text" },
  ],
  candidates: [
    {
      id: "c1",
      label: "血糖",
      value: 7.2,
      unit: "mmol/L",
      referenceRange: { low: 3.9, high: 6.1, text: "3.9–6.1" },
      anchorIds: ["p1-l2"],
      confidence: "high",
      status: "high",
      reason: "Compared with reference range",
      source: "extracted",
    },
  ],
  annotations: [],
  warnings: [],
  analysis: null,
  candidateCount: 1,
  warningCount: 0,
  history: [],
});
const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  calls = [];
  report = reportFixture();
  config = {
    mode: "mock",
    model: "glm-4.7",
    endpoint: "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions",
    keyConfigured: false,
    domain: "检验报告",
    diseaseContext: "血糖研究",
  };
  templates = [
    {
      id: "template-1",
      name: "检验字段",
      domain: "检验报告",
      fields: [{ label: "血糖", aliases: ["GLU"], unit: "mmol/L" }],
    },
  ];
  rules = [
    {
      id: "rule-1",
      name: "血糖参考",
      label: "血糖",
      aliases: ["GLU"],
      kind: "numeric",
      unit: "mmol/L",
      low: 3.9,
      high: 6.1,
      normalValues: [],
      abnormalValues: [],
      enabled: true,
      domain: "",
    },
  ];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    const method = init.method || "GET";
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ path, method, body });
    if (path === "/api/health")
      return respond({
        ok: true,
        version: "1",
        mode: "mock",
        capabilities: {
          pdftotext: true,
          pdftoppm: true,
          tesseract: true,
          antiword: true,
          ocrLanguages: ["eng", "chi_sim"],
        },
      });
    if (path === "/api/config") {
      if (method === "PUT") config = { ...config, ...body };
      return respond(config);
    }
    if (path === "/api/reports" && method === "GET")
      return respond({ reports: [report] });
    if (path === "/api/reports" && method === "POST")
      return respond({
        ...report,
        id: "uploaded-report",
        filename: "新报告.pdf",
        status: "ready",
      });
    if (path === "/api/reports/test-report" && method === "GET")
      return respond(report);
    if (path === "/api/templates" && method === "GET")
      return respond({ templates });
    if (path === "/api/rules" && method === "GET") return respond({ rules });
    if (path === "/api/history")
      return respond({
        history: [
          {
            id: "history-1",
            reportId: report.id,
            action: "report_uploaded",
            createdAt: now,
          },
        ],
      });
    if (path === "/api/reports/test-report/annotations" && method === "POST") {
      report = {
        ...report,
        candidates: [
          {
            ...report.candidates![0],
            value: body.value,
            source: "manual",
            status: "normal",
          },
        ],
        annotations: [{ id: "annotation-1", ...body, createdAt: now }],
      };
      return respond(report);
    }
    if (path === "/api/rules/rule-1" && method === "PUT") {
      rules = [{ id: "rule-1", ...body }];
      return respond(rules[0]);
    }
    if (path === "/api/reports/test-report/ai-preview") {
      return respond({
        previewId: "preview-1",
        expiresAt: "2099-09-30T07:10:00.000Z",
        excerpts: [{ anchorId: "p1-l2", text: "血糖：7.2 mmol/L" }],
        warnings: ["自动脱敏需人工复核"],
        mode: config.mode,
        model: config.model,
        endpoint: config.endpoint,
        payload: {
          model: config.model,
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                context: { domain: "检验报告", diseaseContext: "血糖" },
                evidence: [{ anchorId: "p1-l2", text: "血糖：7.2 mmol/L" }],
              }),
            },
          ],
        },
      });
    }
    if (path === "/api/reports/test-report/analyze") {
      report = {
        ...report,
        analysis: {
          id: "analysis-1",
          mode: "mock",
          model: config.model,
          createdAt: now,
          summary: "已整理选中的检验片段，未调用外部服务。",
          findings: [{ text: "血糖：7.2 mmol/L", anchorIds: ["p1-l2"] }],
          limitations: ["不构成医疗诊断"],
          selectedAnchorIds: ["p1-l2"],
          domain: config.domain,
          diseaseContext: config.diseaseContext,
        },
      };
      return respond(report);
    }
    throw new Error(`Unexpected fetch: ${method} ${path}`);
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
afterAll(() => {
  for (const key of globals) {
    const original = originals.get(key);
    if (original) Object.defineProperty(globalThis, key, original);
    else delete (globalThis as any)[key];
  }
  dom.happyDOM.cancelAsync();
});
async function ready() {
  render(<App />);
  await screen.findByRole("heading", { name: "研究血检.pdf" });
}

describe("Chinese report workspace components", () => {
  it("renders a loaded report with traceable fields and no automatically selected evidence", async () => {
    await ready();
    expect(screen.getByRole("heading", { name: "报告工作台" })).toBeDefined();
    expect(screen.getByText("血糖")).toBeDefined();
    expect(
      screen.getByLabelText("选择第 1 页第 2 行").getAttribute("type"),
    ).toBe("checkbox");
    expect(
      (screen.getByLabelText("选择第 1 页第 2 行") as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByText("本地模拟模式")).toBeDefined();
    expect(
      calls.some(
        (c) => c.path.endsWith("/ai-preview") || c.path.endsWith("/analyze"),
      ),
    ).toBe(false);
  });
  it("navigates history, templates and settings, then saves explicit research context", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /报告历史/ }));
    await screen.findByRole("heading", { name: /全部报告/ });
    await screen.findByText("导入研究报告");
    fireEvent.click(screen.getByRole("button", { name: "字段模板" }));
    expect(
      await screen.findByRole("heading", { name: "检验字段" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "研究与模型设置" }));
    const input = await screen.findByLabelText("疾病 / 研究背景");
    fireEvent.change(input, { target: { value: "肾功能研究" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === "/api/config" && c.method === "PUT")?.body
          .diseaseContext,
      ).toBe("肾功能研究"),
    );
    expect(config.mode).toBe("mock");
    expect(calls.some((c) => String(c.body).includes("api_key"))).toBe(false);
  });
  it("saves numeric manual annotations as numbers with source anchor retained", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "编辑 血糖" }));
    const dialog = screen.getByRole("dialog", { name: "人工核对指标" });
    fireEvent.change(within(dialog).getByLabelText("检测结果 *"), {
      target: { value: "5.4" },
    });
    fireEvent.change(within(dialog).getByLabelText("核对备注"), {
      target: { value: "已核对原文小数点" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存标注" }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith("/annotations"))?.body).toEqual({
        anchorId: "p1-l2",
        label: "血糖",
        value: 5.4,
        unit: "mmol/L",
        referenceLow: 3.9,
        referenceHigh: 6.1,
        note: "已核对原文小数点",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("人工确认")).toBeDefined();
  });
  it("blocks analysis until selected evidence has a fresh preview and explicit consent", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /审核并分析/ }));
    expect(calls.some((c) => c.path.endsWith("/ai-preview"))).toBe(false);
    fireEvent.click(screen.getByLabelText("选择第 1 页第 2 行"));
    fireEvent.click(screen.getByRole("button", { name: /审核并分析/ }));
    let dialog = await screen.findByRole("dialog", {
      name: "审核证据，再开始分析",
    });
    let analyzeButton = within(dialog).getByRole("button", {
      name: "开始本地模拟分析",
    }) as HTMLButtonElement;
    expect(analyzeButton.disabled).toBe(true);
    expect(within(dialog).getByText("完整请求载荷预览")).toBeDefined();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(analyzeButton.disabled).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "返回核对" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /审核并分析/ }));
    dialog = await screen.findByRole("dialog", {
      name: "审核证据，再开始分析",
    });
    analyzeButton = within(dialog).getByRole("button", {
      name: "开始本地模拟分析",
    }) as HTMLButtonElement;
    expect(analyzeButton.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(analyzeButton);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith("/analyze"))?.body).toEqual({
        previewId: "preview-1",
        consent: true,
        anchorIds: ["p1-l2"],
      }),
    );
    expect(
      await screen.findByText("已整理选中的检验片段，未调用外部服务。"),
    ).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("toggles rules using only writable API fields", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "异常判定规则" }));
    const toggle = await screen.findByRole("switch", { name: "停用 血糖参考" });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(
        calls.find((c) => c.path === "/api/rules/rule-1" && c.method === "PUT")
          ?.body.enabled,
      ).toBe(false),
    );
    const body = calls.find(
      (c) => c.path === "/api/rules/rule-1" && c.method === "PUT",
    )?.body;
    expect(body.id).toBeUndefined();
    expect(body.createdAt).toBeUndefined();
    expect(
      await screen.findByRole("switch", { name: "启用 血糖参考" }),
    ).toBeDefined();
  });
  it("submits the chosen report as multipart FormData", async () => {
    await ready();
    const file = new File(["%PDF-1.4 synthetic"], "新报告.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("选择报告文件"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === "/api/reports" && c.method === "POST"),
      ).toBe(true),
    );
    const upload = calls.find(
      (c) => c.path === "/api/reports" && c.method === "POST",
    )!;
    expect(upload.body instanceof FormData).toBe(true);
    expect(upload.body.get("file").name).toBe("新报告.pdf");
    expect(
      await screen.findByRole("heading", { name: "新报告.pdf" }),
    ).toBeDefined();
  });
  it("closes editing dialogs on Escape without persisting changes", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "编辑 血糖" }));
    fireEvent.change(screen.getByLabelText("检测结果 *"), {
      target: { value: "900" },
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.some((c) => c.path.endsWith("/annotations"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "编辑 血糖" }));
    expect(
      (screen.getByLabelText("检测结果 *") as HTMLInputElement).value,
    ).toBe("7.2");
  });
  it("discloses the live provider and keeps transmission blocked until explicit consent", async () => {
    config = { ...config, mode: "live", keyConfigured: true };
    await ready();
    fireEvent.click(screen.getByLabelText("选择第 1 页第 2 行"));
    fireEvent.click(screen.getByRole("button", { name: /审核并分析/ }));
    const dialog = await screen.findByRole("dialog", {
      name: "审核证据，再开始分析",
    });
    const button = within(dialog).getByRole("button", {
      name: "确认发送并分析",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(dialog.textContent).toContain(config.endpoint);
    expect(dialog.textContent).toContain("glm-4.7");
    expect(dialog.textContent).toContain("diseaseContext");
    expect(calls.some((c) => c.path.endsWith("/analyze"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "返回核对" }));
    fireEvent.click(screen.getByLabelText("选择第 1 页第 3 行"));
    fireEvent.click(screen.getByRole("button", { name: /审核并分析/ }));
    const next = await screen.findByRole("dialog", {
      name: "审核证据，再开始分析",
    });
    expect(
      (within(next).getByRole("checkbox") as HTMLInputElement).checked,
    ).toBe(false);
    const previews = calls.filter((c) => c.path.endsWith("/ai-preview"));
    expect(previews.at(-1)?.body.anchorIds).toEqual(["p1-l2", "p1-l3"]);
    expect(calls.some((c) => c.path.endsWith("/analyze"))).toBe(false);
  });
  it("polls a processing report and updates extracted fields when the local job completes", async () => {
    report = {
      ...report,
      status: "processing",
      anchors: [],
      candidates: [],
      job: { id: "job-1", status: "running" },
    };
    await ready();
    expect(screen.getByText("解析中")).toBeDefined();
    expect(screen.getByText("报告正在解析中")).toBeDefined();
    report = reportFixture();
    await waitFor(() => expect(screen.getByText("血糖")).toBeDefined(), {
      timeout: 3000,
    });
    expect(
      calls.filter((c) => c.path === "/api/reports/test-report").length,
    ).toBeGreaterThan(1);
    expect(screen.queryByText("报告正在解析中")).toBeNull();
  });
});
