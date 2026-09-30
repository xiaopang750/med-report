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
const { render, screen, fireEvent, waitFor, cleanup, within, act } =
  await import("@testing-library/react");
const { default: App } = await import("../src/App");
const originalFetch = globalThis.fetch;
let calls: { path: string; method: string; body: any }[] = [];
let report: Report;
let config: Config;
let templates: Template[];
let rules: Rule[];
let authenticated: boolean;
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
  authenticated = true;
  report = reportFixture();
  config = {
    mode: "mock",
    model: "glm-5.3",
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
    if (path === "/api/auth/session")
      return respond({
        authenticated,
        username: authenticated ? "admin" : null,
        demo: true,
      });
    if (path === "/api/auth/login" && method === "POST") {
      if (body.username !== "admin" || body.password !== "admin")
        return respond(
          { code: "INVALID_CREDENTIALS", error: "Invalid credentials" },
          401,
        );
      authenticated = true;
      return respond({ authenticated: true, username: "admin", demo: true });
    }
    if (path === "/api/auth/logout" && method === "POST") {
      authenticated = false;
      return respond({ ok: true });
    }
    if (!authenticated) return respond({ code: "UNAUTHORIZED" }, 401);
    if (path === "/api/parsing")
      return respond({
        defaultMode: "local",
        provider: "mock",
        maxBytes: 20971520,
      });
    if (path === "/api/parsing/preview")
      return respond({
        previewId: "file-preview",
        recipient: "open.bigmodel.cn",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model: "glm-5.3-flash",
        provider: "mock",
        filename: body.filename,
        size: body.size,
        sha256: body.sha256,
        warning: "发送完整原文件，不会脱敏",
      });
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

async function login(username = "admin", password = "admin") {
  await screen.findByRole("heading", { name: "登录研究工作台" });
  fireEvent.change(screen.getByLabelText("用户名"), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
}

describe("Local demo login", () => {
  it("checks the cookie session before requesting or showing report data", async () => {
    let resolveSession!: (response: Response) => void;
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/session")
        return new Promise<Response>((resolve) => {
          resolveSession = resolve;
        });
      return fetchMock(input, init);
    }) as typeof fetch;
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "正在检查登录状态" }),
    ).toBeDefined();
    expect(calls.length).toBe(0);
    expect(screen.queryByRole("heading", { name: "报告工作台" })).toBeNull();
    authenticated = false;
    await act(async () =>
      resolveSession(
        respond({ authenticated: false, username: null, demo: true }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "登录研究工作台" }),
    ).toBeDefined();
    expect(screen.getByText("演示登录 · 仅限本机使用")).toBeDefined();
    expect(screen.getByText(/固定账号不提供生产级安全保护/)).toBeDefined();
    expect(screen.getAllByText("admin").length).toBe(2);
    expect(calls.length).toBe(0);
  });

  it("logs in with admin/admin using same-origin cookies and restores login on reload", async () => {
    authenticated = false;
    const fetchMock = globalThis.fetch;
    let loginOptions: RequestInit | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/login") loginOptions = init;
      return fetchMock(input, init);
    }) as typeof fetch;
    render(<App />);
    await login();
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
    expect(calls.find((call) => call.path === "/api/auth/login")?.body).toEqual(
      { username: "admin", password: "admin" },
    );
    expect(loginOptions?.credentials).toBe("same-origin");
    expect(new Headers(loginOptions?.headers).has("Authorization")).toBe(false);
    expect(dom.localStorage.length).toBe(0);
    expect(dom.sessionStorage.length).toBe(0);
    cleanup();
    await ready();
    expect(
      calls.filter((call) => call.path === "/api/auth/session").length,
    ).toBe(2);
    expect(calls.filter((call) => call.path === "/api/auth/login").length).toBe(
      1,
    );
  });

  it("shows a clear wrong-password error, clears the password, and allows retry", async () => {
    authenticated = false;
    render(<App />);
    await login("admin", "wrong");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "用户名或密码错误，请重试",
    );
    expect((screen.getByLabelText("密码") as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(screen.getByLabelText("密码"));
    expect(
      (screen.getByRole("button", { name: "登录工作台" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(calls.some((call) => call.path === "/api/reports")).toBe(false);
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "admin" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
  });

  it("disables the login form and suppresses duplicate submits while pending", async () => {
    authenticated = false;
    let resolveLogin!: (response: Response) => void;
    let attempts = 0;
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/login") {
        attempts++;
        return new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        });
      }
      return fetchMock(input, init);
    }) as typeof fetch;
    render(<App />);
    await login();
    const form = screen.getByRole("form", { name: "演示登录" });
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByLabelText("用户名") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((screen.getByLabelText("密码") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "正在登录…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(attempts).toBe(1);
    await act(async () =>
      resolveLogin(respond({ code: "INVALID_CREDENTIALS" }, 401)),
    );
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(
      (screen.getByRole("button", { name: "登录工作台" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps reports hidden on a session-check failure and supports reconnecting", async () => {
    const fetchMock = globalThis.fetch;
    let fail = true;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/session" && fail)
        throw new Error("连接失败");
      return fetchMock(input, init);
    }) as typeof fetch;
    render(<App />);
    expect(
      await screen.findByRole("heading", { name: "暂时无法连接工作台" }),
    ).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe("连接失败");
    expect(calls.some((call) => call.path === "/api/reports")).toBe(false);
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
  });

  it("clears report UI as logout starts, then creates a fresh workspace on re-login", async () => {
    await ready();
    fireEvent.click(screen.getByLabelText("选择第 1 页第 2 行"));
    fireEvent.click(screen.getByRole("button", { name: "编辑 血糖" }));
    let resolveLogout!: (response: Response) => void;
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/logout")
        return new Promise<Response>((resolve) => {
          resolveLogout = resolve;
        });
      return fetchMock(input, init);
    }) as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(screen.getByRole("heading", { name: "正在退出登录" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "研究血检.pdf" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("选择第 1 页第 2 行")).toBeNull();
    authenticated = false;
    await act(async () => resolveLogout(respond({ ok: true })));
    expect(await screen.findByText("已退出登录")).toBeDefined();
    await login();
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
    expect(
      (screen.getByLabelText("选择第 1 页第 2 行") as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      calls.filter(
        (call) => call.path === "/api/reports" && call.method === "GET",
      ).length,
    ).toBe(2);
  });

  it("keeps report data cleared and offers retry when logout fails", async () => {
    await ready();
    let fail = true;
    const fetchMock = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/auth/logout" && fail)
        throw new Error("连接失败");
      return fetchMock(input, init);
    }) as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(
      await screen.findByRole("heading", { name: "退出未完成" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "研究血检.pdf" })).toBeNull();
    expect(screen.getByText(/服务端登录状态尚未确认退出/)).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "重试退出" }));
    expect(
      await screen.findByRole("heading", { name: "登录研究工作台" }),
    ).toBeDefined();
    expect(authenticated).toBe(false);
  });

  it("returns to login on an expired protected request and accepts a fresh login", async () => {
    await ready();
    authenticated = false;
    fireEvent.click(screen.getByRole("button", { name: "重新判定" }));
    expect(
      await screen.findByRole("heading", { name: "登录研究工作台" }),
    ).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe(
      "登录已过期，请重新登录",
    );
    expect(screen.queryByText("血糖")).toBeNull();
    await login();
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
  });

  it("also handles an expired cookie during report download", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "导出当前报告" }));
    const dialog = screen.getByRole("dialog", { name: "导出研究报告" });
    authenticated = false;
    fireEvent.click(within(dialog).getByRole("button", { name: /CSV/ }));
    expect(
      await screen.findByRole("heading", { name: "登录研究工作台" }),
    ).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe(
      "登录已过期，请重新登录",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores a late 401 from the previous workspace after re-login", async () => {
    await ready();
    const { api } = await import("../src/api");
    const fetchMock = globalThis.fetch;
    let resolveOld!: (response: Response) => void;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input) === "/api/old-request")
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      return fetchMock(input, init);
    }) as typeof fetch;
    const oldRequest = api("/old-request").catch((error) => error);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await login();
    expect(
      await screen.findByRole("heading", { name: "研究血检.pdf" }),
    ).toBeDefined();
    await act(async () => {
      resolveOld(respond({ code: "UNAUTHORIZED" }, 401));
      await oldRequest;
    });
    expect(screen.getByRole("heading", { name: "研究血检.pdf" })).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "登录研究工作台" }),
    ).toBeNull();
  });

  it("does not start a pending report download after logout", async () => {
    await ready();
    const { downloadReport } = await import("../src/api");
    const fetchMock = globalThis.fetch;
    const createObjectURL = URL.createObjectURL;
    let createdUrls = 0;
    let resolveBlob!: (blob: Blob) => void;
    const response = new Response("report export");
    response.blob = () =>
      new Promise<Blob>((resolve) => {
        resolveBlob = resolve;
      });
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (String(input).includes("/export?")) return response;
      return fetchMock(input, init);
    }) as typeof fetch;
    URL.createObjectURL = () => {
      createdUrls++;
      return "blob:unexpected-download";
    };
    try {
      const download = downloadReport(
        "test-report",
        "csv",
        "研究血检.pdf",
      ).catch((error) => error);
      await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
      await screen.findByRole("heading", { name: "登录研究工作台" });
      resolveBlob(new Blob(["report export"]));
      const error = await download;
      expect(error.code).toBe("SESSION_CHANGED");
      expect(createdUrls).toBe(0);
    } finally {
      URL.createObjectURL = createObjectURL;
    }
  });
});

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
        (
          screen.getByRole("button", {
            name: "上传并解析",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "上传并解析" }));
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
  it("requires a file-specific unchecked consent before GLM upload and resets it on mode change", async () => {
    await ready();
    const file = new File(["%PDF-fictional"], "新报告.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(screen.getByLabelText("选择报告文件"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("文件解析模式") as HTMLSelectElement).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("文件解析模式"), {
      target: { value: "glm" },
    });
    expect(
      (screen.getByRole("button", { name: "上传并解析" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      calls.some((c) => c.path === "/api/reports" && c.method === "POST"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "核对接收方与完整文件上传" }),
    );
    const consent = await screen.findByRole("checkbox", {
      name: /我已核对接收方/,
    });
    expect((consent as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/发送完整原文件/)).toBeDefined();
    fireEvent.click(consent);
    fireEvent.change(screen.getByLabelText("文件解析模式"), {
      target: { value: "local" },
    });
    fireEvent.change(screen.getByLabelText("文件解析模式"), {
      target: { value: "glm" },
    });
    expect(
      (screen.getByRole("button", { name: "上传并解析" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "核对接收方与完整文件上传" }),
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /我已核对接收方/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "上传并解析" }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === "/api/reports" && c.method === "POST"),
      ).toBe(true),
    );
    const form = calls.find(
      (c) => c.path === "/api/reports" && c.method === "POST",
    )!.body as FormData;
    expect(form.get("mode")).toBe("glm");
    expect(form.get("consent")).toBe("true");
    expect(form.get("previewId")).toBe("file-preview");
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
    expect(dialog.textContent).toContain("glm-5.3");
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
