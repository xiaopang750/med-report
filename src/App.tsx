import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileClock,
  FileSearch,
  FileText,
  FlaskConical,
  FolderClock,
  Grip,
  History,
  Info,
  Layers3,
  LayoutDashboard,
  Link2,
  Loader2,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Tag,
  Trash2,
  UploadCloud,
  X,
  AlertCircle,
  AlertTriangle,
  ListFilter,
  NotebookPen,
  Eye,
  Filter,
} from "lucide-react";
import { api, json, downloadReport } from "./api";
import type {
  Page,
  Report,
  Candidate,
  Anchor,
  Annotation,
  Template,
  Rule,
  Config,
  Preview,
  Health,
} from "./types";

const navigation: { id: Page; label: string; icon: typeof LayoutDashboard }[] =
  [
    { id: "workspace", label: "报告工作台", icon: LayoutDashboard },
    { id: "history", label: "报告历史", icon: FolderClock },
    { id: "templates", label: "字段模板", icon: Layers3 },
    { id: "rules", label: "异常判定规则", icon: SlidersHorizontal },
    { id: "settings", label: "研究与模型设置", icon: Settings2 },
  ];
const statusLabels: Record<string, string> = {
  ready: "解析完成",
  needs_review: "待人工复核",
  error: "解析失败",
  processing: "解析中",
  queued: "等待解析",
  running: "正在解析",
};
const candidateLabels: Record<string, string> = {
  normal: "正常",
  high: "偏高",
  low: "偏低",
  abnormal: "异常",
  uncertain: "待复核",
};
const confidenceLabels: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
const fmtDate = (value: string) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "—";
const fmtSize = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const reportType = (r: Report) =>
  r.source === "demo"
    ? "DEMO"
    : r.mime?.includes("pdf")
      ? "PDF"
      : r.mime?.startsWith("image/")
        ? "IMAGE"
        : "WORD";
const arrayText = (v?: string[]) => v?.join("、") || "";
const splitText = (v: string) =>
  v
    .split(/[，,、\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
const getPages = (r: Pick<Report, "anchors">) =>
  Math.max(0, ...(r.anchors || []).map((a) => a.page));
const errText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请稍后重试";
const isAbnormal = (c: Candidate) =>
  ["high", "low", "abnormal"].includes(c.status);
const rangeText = (c: Candidate) =>
  c.referenceRange?.text ||
  (c.referenceRange?.low !== undefined || c.referenceRange?.high !== undefined
    ? `${c.referenceRange?.low ?? "−∞"} – ${c.referenceRange?.high ?? "+∞"}`
    : "未提供");
function Button({
  children,
  onClick,
  variant = "",
  small = false,
  disabled = false,
  type = "button",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  small?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  [key: string]: any;
}) {
  return (
    <button
      type={type}
      className={`button ${variant} ${small ? "small" : ""}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
function Badge({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function FileIcon({ report }: { report?: Report }) {
  return (
    <span
      className={`file-icon ${report && reportType(report) === "PDF" ? "pdf" : report && reportType(report) === "IMAGE" ? "image" : ""}`}
    >
      <FileText size={19} />
    </span>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    previousFocus.current = document.activeElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = dialogRef.current;
    const first = el?.querySelector<HTMLElement>(
      "button,input,select,textarea",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key === "Tab" && el) {
        const els = Array.from(
          el.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]",
          ),
        ).filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      (previousFocus.current as HTMLElement)?.focus?.();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
function Empty({
  title,
  description,
  icon: Icon = FileSearch,
  children,
}: {
  title: string;
  description: string;
  icon?: typeof FileSearch;
  children?: ReactNode;
}) {
  return (
    <div className="empty-workspace">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("workspace");
  const [reports, setReports] = useState<Report[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const [sidebar, setSidebar] = useState(false);
  const [dragover, setDragover] = useState(false);
  const [tab, setTab] = useState<"fields" | "evidence" | "analysis">("fields");
  const [selected, setSelected] = useState<string[]>([]);
  const [focused, setFocused] = useState("");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<
    | "field"
    | "template"
    | "rule"
    | "apply"
    | "preview"
    | "export"
    | "help"
    | "delete"
    | null
  >(null);
  const [editField, setEditField] = useState<Candidate | null>(null);
  const [editTemplate, setEditTemplate] = useState<Template | null>(null);
  const [editRule, setEditRule] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [consent, setConsent] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: "template" | "rule" | "annotation";
    id: string;
    label: string;
  } | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<string | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const notify = useCallback(
    (text: string, error = false) => setToast({ text, error }),
    [],
  );
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const refreshLists = useCallback(async () => {
    const [rs, ts, rl] = await Promise.all([
      api<{ reports: Report[] }>("/reports"),
      api<{ templates: Template[] }>("/templates"),
      api<{ rules: Rule[] }>("/rules"),
    ]);
    setReports(rs.reports);
    setTemplates(ts.templates);
    setRules(rl.rules);
    return rs.reports;
  }, []);
  const openReport = useCallback(
    async (id: string, navigate = true) => {
      selectedRef.current = id;
      setBusy("open");
      try {
        const r = await api<Report>(`/reports/${id}`);
        if (selectedRef.current === id) {
          setReport(r);
          setSelected([]);
          setFocused("");
          setTab("fields");
          if (navigate) setPage("workspace");
        }
      } catch (e) {
        notify(errText(e), true);
      } finally {
        setBusy("");
      }
    },
    [notify],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rs, ts, rl, c, h] = await Promise.all([
          api<{ reports: Report[] }>("/reports"),
          api<{ templates: Template[] }>("/templates"),
          api<{ rules: Rule[] }>("/rules"),
          api<Config>("/config"),
          api<Health>("/health"),
        ]);
        if (cancelled) return;
        setReports(rs.reports);
        setTemplates(ts.templates);
        setRules(rl.rules);
        setConfig(c);
        setHealth(h);
        if (rs.reports.length) {
          const r = await api<Report>(`/reports/${rs.reports[0].id}`);
          if (!cancelled) {
            setReport(r);
            selectedRef.current = r.id;
          }
        }
      } catch (e) {
        if (!cancelled) setError(errText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!report || report.status !== "processing") return;
    const id = report.id;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const r = await api<Report>(`/reports/${id}`);
        if (!stopped && selectedRef.current === id) {
          setReport(r);
          if (r.status !== "processing") {
            await refreshLists();
            notify(
              r.status === "error"
                ? "报告解析失败，请查看详情"
                : "报告解析完成，请复核提取结果",
              r.status === "error",
            );
          }
        }
      } catch (e) {
        if (!stopped) notify(errText(e), true);
      }
    }, 1800);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [report?.id, report?.status, notify, refreshLists]);
  useEffect(() => {
    if (page === "history") {
      api<{ history: any[] }>("/history")
        .then((r) => setActivity(r.history))
        .catch((e) => notify(errText(e), true));
      refreshLists().catch((e) => notify(errText(e), true));
    }
  }, [page, notify, refreshLists]);
  const updateReport = (r: Report) => {
    setReport(r);
    selectedRef.current = r.id;
    setReports((rs) =>
      rs.some((x) => x.id === r.id)
        ? rs.map((x) => (x.id === r.id ? r : x))
        : [r, ...rs],
    );
  };
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (e) {
      notify(errText(e), true);
    } finally {
      setBusy("");
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > Number(health?.limits?.maxFileBytes || 20 * 1024 * 1024)) {
      notify("文件超过本地上传上限，请压缩或拆分后重试", true);
      return;
    }
    await run("upload", async () => {
      const form = new FormData();
      form.append("file", file);
      const r = await api<Report>("/reports", { method: "POST", body: form });
      updateReport(r);
      setSelected([]);
      setTab("fields");
      setPage("workspace");
      notify(
        r.status === "processing"
          ? "报告已加入本地解析队列"
          : "报告已导入，请复核提取结果",
      );
      await refreshLists();
    });
    if (uploadRef.current) uploadRef.current.value = "";
  };
  const loadDemo = () =>
    run("demo", async () => {
      const r = await api<Report>("/demo", { method: "POST" });
      updateReport(r);
      setSelected([]);
      setTab("fields");
      setPage("workspace");
      notify("已加载合成示例，不含真实个人数据");
      await refreshLists();
    });
  const go = (p: Page) => {
    setPage(p);
    setSidebar(false);
  };
  const focusAnchor = (id: string) => {
    setFocused(id);
    if (tab === "analysis") setTab("evidence");
    setTimeout(
      () =>
        document
          .getElementById(`anchor-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      60,
    );
  };
  const maxSelected = Number(health?.limits?.maxSelectedExcerpts || 40);
  const toggleAnchor = (id: string) => {
    if (!selected.includes(id) && selected.length >= maxSelected) {
      notify(`每次最多选择 ${maxSelected} 个片段，请先取消部分选择`, true);
      return;
    }
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  };
  const showField = (field: Candidate | null = null, anchorId?: string) => {
    setEditField(field);
    if (anchorId) setFocused(anchorId);
    setModal("field");
  };
  const previewAI = () => {
    if (!report) return;
    if (!selected.length) {
      notify("请先在原文证据中勾选需要分析的片段", true);
      setTab("evidence");
      return;
    }
    run("preview", async () => {
      const p = await api<Preview>(`/reports/${report.id}/ai-preview`, {
        method: "POST",
        body: json({ anchorIds: selected }),
      });
      setPreview(p);
      setConsent(false);
      setModal("preview");
    });
  };
  const analyze = () => {
    if (!report || !preview || !consent) return;
    run("analyze", async () => {
      const r = await api<Report>(`/reports/${report.id}/analyze`, {
        method: "POST",
        body: json({
          previewId: preview.previewId,
          consent: true,
          anchorIds: selected,
        }),
      });
      updateReport(r);
      setModal(null);
      setTab("analysis");
      notify(
        preview.mode === "mock"
          ? "本地模拟分析已生成，所有结论均可溯源"
          : "分析完成，请复核证据与不确定性",
      );
    });
  };
  const evaluate = () => {
    if (report)
      run("evaluate", async () => {
        const r = await api<Report>(`/reports/${report.id}/evaluate`, {
          method: "POST",
        });
        updateReport(r);
        notify("已按当前规则重新判定");
      });
  };
  const remove = () => {
    if (!deleteTarget) return;
    run("delete", async () => {
      if (deleteTarget.kind === "annotation" && report) {
        const r = await api<Report>(
          `/reports/${report.id}/annotations/${deleteTarget.id}`,
          { method: "DELETE" },
        );
        updateReport(r);
      } else {
        await api(
          `/${deleteTarget.kind === "template" ? "templates" : "rules"}/${deleteTarget.id}`,
          { method: "DELETE" },
        );
        await refreshLists();
      }
      setModal(null);
      setDeleteTarget(null);
      notify("已删除");
    });
  };
  const askDelete = (
    kind: "template" | "rule" | "annotation",
    id: string,
    label: string,
  ) => {
    setDeleteTarget({ kind, id, label });
    setModal("delete");
  };
  const activeCount = reports.filter(
    (r) => r.status === "ready" || r.status === "needs_review",
  ).length;
  const candidates = report?.candidates || [];
  const anchors = report?.anchors || [];
  const abnormal = candidates.filter(isAbnormal);
  const reviewCount = candidates.filter((c) => c.status === "uncertain").length;
  const pending = report?.status === "processing";
  const navLabel = navigation.find((n) => n.id === page)?.label;
  const evidence = (
    <Evidence
      report={report}
      selected={selected}
      focused={focused}
      onToggle={toggleAnchor}
      onFocus={setFocused}
      onAnnotate={(id) => showField(null, id)}
      onClear={() => setSelected([])}
      maxSelected={maxSelected}
      onSelectAll={() =>
        setSelected(anchors.slice(0, maxSelected).map((a) => a.id))
      }
    />
  );
  return (
    <div className="app">
      <div
        className={`mobile-overlay ${sidebar ? "open" : ""}`}
        onClick={() => setSidebar(false)}
      />
      <aside className={`sidebar ${sidebar ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div>
            <div className="brand-name">医疗报告</div>
            <div className="brand-sub">MED-REPORT STUDIO</div>
          </div>
        </div>
        <div className="nav-label">研究工作空间</div>
        <nav className="nav" aria-label="主导航">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              className={page === id ? "active" : ""}
              key={id}
              onClick={() => go(id)}
            >
              <Icon size={17} />
              {label}
              {id === "history" && reports.length > 0 && (
                <span className="nav-count">{reports.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <div className="privacy-title">
              <ShieldCheck size={15} />
              你的数据，由你掌握
            </div>
            <p>
              文件在本地解析与保存
              <br />
              AI 仅接收经你确认的脱敏片段
            </p>
          </div>
          <div className="workspace-person">
            <div className="avatar">研</div>
            <div>
              <div className="person-name">个人研究空间</div>
              <div className="person-role">LOCAL WORKSPACE</div>
            </div>
            <LockKeyhole size={13} />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="打开导航"
              onClick={() => setSidebar(true)}
            >
              <Menu size={18} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={12} />
            <span>{navLabel}</span>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <i className="status-dot" />
              本地优先 · 隐私保护
            </span>
            <span className="topbar-version">RESEARCH EDITION</span>
            <button
              className="icon-button"
              title="使用指南"
              aria-label="使用指南"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={16} />
            </button>
          </div>
        </header>
        <main className="content">
          <div className="page-header">
            <div>
              <div className="eyebrow">
                {page === "workspace"
                  ? "FROM REPORTS TO INSIGHTS"
                  : page === "history"
                    ? "YOUR RESEARCH, ORGANIZED"
                    : page === "templates"
                      ? "STRUCTURE YOU CAN REUSE"
                      : page === "rules"
                        ? "CONSISTENT, TRACEABLE REVIEW"
                        : "YOUR RESEARCH CONTEXT"}
              </div>
              <h1>{navLabel}</h1>
              <p className="subtitle">
                {page === "workspace"
                  ? "让复杂报告成为清晰、可追溯的研究线索。每一次发现，都有据可循。"
                  : page === "history"
                    ? "所有报告与分析记录，妥善保存在你的本地工作空间。"
                    : page === "templates"
                      ? "将常用字段整理为模板，让不同格式的报告使用同一套研究语言。"
                      : page === "rules"
                        ? "定义研究范围和异常条件，每一项判定都保留清晰依据。"
                        : "为分析补充专业背景，并明确配置模型与数据边界。"}
              </p>
            </div>
            <div className="header-actions">
              {page === "workspace" && (
                <>
                  <Button onClick={loadDemo} disabled={!!busy}>
                    <FlaskConical size={14} />
                    {busy === "demo" ? "正在加载" : "体验示例"}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => uploadRef.current?.click()}
                    disabled={!!busy}
                  >
                    <Plus size={15} />
                    导入报告
                  </Button>
                </>
              )}
              {page === "history" && (
                <Button
                  variant="primary"
                  onClick={() => uploadRef.current?.click()}
                  disabled={!!busy}
                >
                  <Plus size={14} />
                  导入报告
                </Button>
              )}
              {page === "templates" && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditTemplate(null);
                    setModal("template");
                  }}
                >
                  <Plus size={14} />
                  新建模板
                </Button>
              )}
              {page === "rules" && (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditRule(null);
                    setModal("rule");
                  }}
                >
                  <Plus size={14} />
                  新建规则
                </Button>
              )}
            </div>
          </div>
          <input
            ref={uploadRef}
            style={{ display: "none" }}
            type="file"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp"
            aria-label="选择报告文件"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          {error && (
            <div className="alert error">
              <AlertCircle size={16} />
              <span>{error}。请确认本地服务已启动。</span>
              <Button small onClick={() => window.location.reload()}>
                重试连接
              </Button>
            </div>
          )}
          {loading ? (
            <div className="view-card">
              <Empty
                icon={Loader2}
                title="正在连接本地工作空间"
                description="读取报告、字段模板与研究设置…"
              />
            </div>
          ) : (
            <>
              {page === "workspace" && (
                <>
                  <div className="overview-row">
                    <Stat
                      icon={FileText}
                      label="报告资料库"
                      value={String(reports.length).padStart(2, "0")}
                      unit="份报告"
                      note={`${activeCount} 份已解析`}
                    />
                    <Stat
                      icon={ScanLine}
                      color="blue"
                      label="当前报告提取"
                      value={String(candidates.length).padStart(2, "0")}
                      unit="项研究指标"
                      note="原文可追溯"
                    />
                    <Stat
                      icon={Activity}
                      color="amber"
                      label="待关注指标"
                      value={String(abnormal.length + reviewCount).padStart(
                        2,
                        "0",
                      )}
                      unit="项需复核"
                      note="规则辅助判定"
                    />
                  </div>
                  <div className="upload-layout">
                    <section className="upload-card">
                      <div className="upload-card-heading">
                        <h2 className="section-label">
                          <UploadCloud size={15} />
                          导入研究报告
                        </h2>
                        <span className="upload-hint">
                          单文件最大{" "}
                          {fmtSize(
                            Number(
                              health?.limits?.maxFileBytes || 20 * 1024 * 1024,
                            ),
                          )}{" "}
                          · 本地解析
                        </span>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="上传报告，支持拖放"
                        className={`dropzone ${dragover ? "dragover" : ""}`}
                        onClick={() => !busy && uploadRef.current?.click()}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && !busy) {
                            e.preventDefault();
                            uploadRef.current?.click();
                          }
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragover(true);
                        }}
                        onDragLeave={() => setDragover(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragover(false);
                          if (!busy) upload(e.dataTransfer.files[0]);
                        }}
                      >
                        <div className="upload-illustration">
                          {busy === "upload" ? (
                            <Loader2 size={26} className="spinner" />
                          ) : (
                            <FileText size={28} />
                          )}
                        </div>
                        <div>
                          <div className="drop-title">
                            {busy === "upload" ? (
                              "正在上传至本地工作空间…"
                            ) : (
                              <>
                                拖拽报告至此，或<span>点击选择文件</span>
                              </>
                            )}
                          </div>
                          <div className="drop-sub">
                            原文件本地保存，自动识别文本与表格内容
                            <br />
                            扫描件及图片使用本地 OCR，解析后请人工核对
                          </div>
                          {busy === "upload" ? (
                            <div className="upload-progress" />
                          ) : (
                            <div className="upload-formats">
                              <span className="format">PDF</span>
                              <span className="format">DOC / DOCX</span>
                              <span className="format">JPG / PNG</span>
                              <span className="format">TIFF / WEBP</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </section>
                    <aside className="guide-card">
                      <h2 className="guide-head">
                        <Sparkles size={14} />
                        让研究更有条理
                      </h2>
                      <div className="guide-list">
                        <div className="guide-step">
                          <span>1</span>
                          <strong>导入报告</strong> 自动提取关键字段
                        </div>
                        <div className="guide-step">
                          <span>2</span>
                          <strong>核对证据</strong> 关联原文与研究规则
                        </div>
                        <div className="guide-step">
                          <span>3</span>
                          <strong>形成洞察</strong> 审核、分析并导出
                        </div>
                      </div>
                    </aside>
                  </div>
                  <div className="workspace-heading">
                    <h2>
                      当前研究报告{" "}
                      {report?.source === "demo" && <span>合成示例</span>}
                    </h2>
                    {reports.length > 0 && (
                      <select
                        className="document-select"
                        aria-label="切换报告"
                        value={report?.id || ""}
                        onChange={(e) => openReport(e.target.value)}
                        disabled={!!busy}
                      >
                        {reports.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.filename}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <section className="workspace-card">
                    {report ? (
                      <>
                        <div className="document-titlebar">
                          <FileIcon report={report} />
                          <div className="file-info">
                            <h3 className="file-name">{report.filename}</h3>
                            <div className="file-meta">
                              <span>{reportType(report)}</span>
                              <span>·</span>
                              <span>{fmtSize(report.size)}</span>
                              <span>·</span>
                              <span>{getPages(report) || "—"} 页</span>
                              <span className="hide-mobile">·</span>
                              <span className="hide-mobile">
                                导入于 {fmtDate(report.createdAt)}
                              </span>
                            </div>
                          </div>
                          <Badge
                            tone={
                              pending
                                ? "blue"
                                : report.status === "ready"
                                  ? "teal"
                                  : report.status === "error"
                                    ? "red"
                                    : "amber"
                            }
                          >
                            {pending ? (
                              <Loader2 size={10} className="spinner" />
                            ) : report.status === "ready" ? (
                              <CheckCircle2 size={10} />
                            ) : (
                              <AlertCircle size={10} />
                            )}{" "}
                            {statusLabels[report.status] || report.status}
                          </Badge>
                          <div className="workspace-title-actions">
                            <button
                              className="icon-button"
                              aria-label="导出当前报告"
                              title="导出报告"
                              onClick={() => setModal("export")}
                              disabled={pending}
                            >
                              <Download size={16} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="从报告创建模板"
                              title="从报告创建模板"
                              onClick={() => {
                                setEditTemplate({
                                  id: "",
                                  name: "",
                                  domain: config?.domain || "",
                                  fields: candidates.map((c) => ({
                                    label: c.label,
                                    aliases: [c.label],
                                    unit: c.unit,
                                  })),
                                });
                                setModal("template");
                              }}
                              disabled={!candidates.length}
                            >
                              <Save size={15} />
                            </button>
                          </div>
                        </div>
                        {pending && (
                          <div className="extraction-status">
                            <Loader2 size={15} className="spinner" />
                            <span>
                              {report.job?.status === "queued"
                                ? "已加入解析队列，等待 CPU 工作进程…"
                                : "正在本地提取文本 / OCR…"}{" "}
                              你可以继续查看其他报告，完成后自动更新。
                            </span>
                          </div>
                        )}
                        {report.status === "error" && (
                          <div className="extraction-status">
                            <AlertTriangle size={15} />
                            <span>
                              解析未完成：
                              {report.job?.error ||
                                report.warnings?.join("；") ||
                                "文件可能已损坏，或对应解析工具未安装。请查看研究设置中的本地能力。"}
                            </span>
                            <Button small onClick={() => go("settings")}>
                              检查设置
                            </Button>
                          </div>
                        )}
                        <div className="document-tabs">
                          <button
                            className={tab === "fields" ? "active" : ""}
                            onClick={() => setTab("fields")}
                          >
                            <ScanLine size={12} />
                            字段与证据 <small>{candidates.length}</small>
                          </button>
                          <button
                            className={tab === "evidence" ? "active" : ""}
                            onClick={() => setTab("evidence")}
                          >
                            <FileSearch size={12} />
                            原文与标注 <small>{anchors.length}</small>
                          </button>
                          <button
                            className={tab === "analysis" ? "active" : ""}
                            onClick={() => setTab("analysis")}
                          >
                            <Sparkles size={12} />
                            分析结果 {report.analysis && <small>1</small>}
                          </button>
                          <div className="spacer" />
                          {config?.mode === "mock" && (
                            <Badge tone="blue">本地模拟模式</Badge>
                          )}
                        </div>
                        {tab === "fields" && (
                          <div className="workspace-columns">
                            <div className="fields-panel">
                              <div className="panel-header">
                                <h3>
                                  <ListFilter size={13} />
                                  已提取的关键指标
                                </h3>
                                <Button
                                  small
                                  variant="ghost"
                                  onClick={() => showField()}
                                  disabled={!anchors.length || pending}
                                >
                                  <Plus size={12} />
                                  手动补充
                                </Button>
                              </div>
                              {candidates.length ? (
                                <div className="table-scroll">
                                  <table className="field-table">
                                    <thead>
                                      <tr>
                                        <th>指标名称</th>
                                        <th>检测结果</th>
                                        <th>参考范围</th>
                                        <th>状态</th>
                                        <th>原文</th>
                                        <th aria-label="操作" />
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {candidates.map((c) => (
                                        <tr
                                          key={c.id}
                                          className={
                                            c.anchorIds.includes(focused)
                                              ? "field-row-selected"
                                              : ""
                                          }
                                        >
                                          <td>
                                            <span className="field-key">
                                              {c.label}
                                            </span>
                                            {c.source === "manual" && (
                                              <div
                                                className="muted"
                                                style={{
                                                  fontSize: 8,
                                                  marginTop: 3,
                                                }}
                                              >
                                                人工确认
                                              </div>
                                            )}
                                          </td>
                                          <td>
                                            <span
                                              className={`field-value ${isAbnormal(c) ? "abnormal-value" : ""}`}
                                            >
                                              {c.value ?? "—"}
                                              <span className="field-unit">
                                                {c.unit}
                                              </span>
                                            </span>
                                          </td>
                                          <td style={{ fontSize: 9 }}>
                                            {rangeText(c)}
                                          </td>
                                          <td>
                                            <span
                                              className={`field-state ${c.status === "normal" ? "normal" : isAbnormal(c) ? "abnormal" : "unknown"}`}
                                              title={c.reason}
                                            >
                                              {c.status === "high" ? (
                                                <ArrowUp size={10} />
                                              ) : c.status === "low" ? (
                                                <ArrowDown size={10} />
                                              ) : c.status === "normal" ? (
                                                <Check size={10} />
                                              ) : (
                                                <AlertCircle size={10} />
                                              )}{" "}
                                              {candidateLabels[c.status] ||
                                                "待复核"}
                                            </span>
                                          </td>
                                          <td>
                                            <button
                                              className="anchor-button"
                                              onClick={() =>
                                                focusAnchor(c.anchorIds[0])
                                              }
                                              title={`置信度：${confidenceLabels[c.confidence] || c.confidence}；${c.reason}`}
                                            >
                                              <Link2 size={10} />
                                              {c.anchorIds[0]
                                                ?.replace("p", "P")
                                                .replace("-l", ":") || "—"}
                                            </button>
                                          </td>
                                          <td>
                                            <button
                                              className="icon-button"
                                              aria-label={`编辑 ${c.label}`}
                                              title="人工核对 / 编辑"
                                              onClick={() => showField(c)}
                                            >
                                              <Pencil size={11} />
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <Empty
                                  title={
                                    pending
                                      ? "报告正在解析中"
                                      : "尚未提取到指标"
                                  }
                                  description={
                                    pending
                                      ? "后台正在进行有界 CPU 解析，请稍候。"
                                      : "你可以为原文片段手动补充字段，或应用包含别名映射的字段模板。"
                                  }
                                  icon={pending ? Loader2 : ScanLine}
                                />
                              )}
                              <div className="fields-footnote">
                                <Info size={11} />
                                <span>
                                  判定依据为当前规则与报告参考区间，不构成诊断。点击原文锚点可核查来源，OCR
                                  结果需人工复核。
                                </span>
                              </div>
                              {report.warnings?.length ? (
                                <div
                                  className="fields-footnote"
                                  style={{ color: "#b19a73" }}
                                >
                                  <AlertTriangle size={11} />
                                  <span>{report.warnings.join("；")}</span>
                                </div>
                              ) : null}
                            </div>
                            <aside className="evidence-panel">{evidence}</aside>
                          </div>
                        )}
                        {tab === "evidence" && (
                          <div className="evidence-full">
                            {evidence}
                            <div className="annotation-list">
                              {(report.annotations || []).map((a) => (
                                <div className="annotation-item" key={a.id}>
                                  <NotebookPen size={13} />
                                  <div className="annotation-text">
                                    <small>
                                      人工标注 · {a.anchorId} ·{" "}
                                      {fmtDate(a.createdAt)}
                                    </small>
                                    <strong>
                                      {a.label}：{a.value} {a.unit}
                                    </strong>
                                    {a.note && <div>{a.note}</div>}
                                  </div>
                                  <button
                                    className="icon-button"
                                    title="删除此人工标注"
                                    aria-label={`删除 ${a.label} 标注`}
                                    onClick={() =>
                                      askDelete("annotation", a.id, a.label)
                                    }
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {tab === "analysis" && (
                          <AnalysisView
                            analysis={report.analysis || null}
                            onEvidence={focusAnchor}
                            onAnalyze={previewAI}
                            selectedCount={selected.length}
                            config={config}
                          />
                        )}
                        <div className="workspace-footer">
                          <div className="research-note">
                            <ShieldCheck size={13} />
                            <span>
                              {selected.length ? (
                                <>
                                  已选择 {selected.length} 个证据片段 · AI
                                  分析前将显示脱敏预览
                                </>
                              ) : (
                                "原文不会自动发送给模型，请先勾选需要分析的证据片段"
                              )}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 9 }}>
                            <Button
                              small
                              onClick={() => setModal("apply")}
                              disabled={pending || !templates.length}
                            >
                              <Layers3 size={13} />
                              应用模板
                            </Button>
                            <Button
                              small
                              onClick={evaluate}
                              disabled={!!busy || !candidates.length}
                            >
                              <RefreshCw
                                size={12}
                                className={busy === "evaluate" ? "spinner" : ""}
                              />
                              重新判定
                            </Button>
                            <Button
                              variant="primary"
                              onClick={previewAI}
                              disabled={!!busy || pending || !anchors.length}
                            >
                              {busy === "preview" ? (
                                <Loader2 size={13} className="spinner" />
                              ) : (
                                <Sparkles size={13} />
                              )}
                              审核并分析 <ArrowRight size={12} />
                            </Button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <Empty
                        title="你的研究，从第一份报告开始"
                        description="上传 Word、PDF 或图片报告，或使用合成示例体验完整流程。文件在本地解析，AI 分析始终由你确认。"
                      >
                        <Button small variant="soft" onClick={loadDemo}>
                          <FlaskConical size={13} />
                          打开合成示例
                        </Button>
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "history" && (
                <>
                  <section className="view-card">
                    <div className="view-card-head">
                      <div>
                        <h2>
                          全部报告{" "}
                          <span
                            className="muted"
                            style={{ fontSize: 11, fontWeight: 400 }}
                          >
                            {" "}
                            / {reports.length}
                          </span>
                        </h2>
                        <p>原文、标注与分析结果一起保存，随时回到研究现场</p>
                      </div>
                      <div className="search-input">
                        <Search size={15} />
                        <input
                          placeholder="搜索报告名称…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          aria-label="搜索报告"
                        />
                      </div>
                    </div>
                    {reports.filter((r) =>
                      r.filename.toLowerCase().includes(search.toLowerCase()),
                    ).length ? (
                      <div className="table-scroll">
                        <table className="history-table">
                          <thead>
                            <tr>
                              <th>报告名称</th>
                              <th>导入时间</th>
                              <th>状态</th>
                              <th>提取字段</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {reports
                              .filter((r) =>
                                r.filename
                                  .toLowerCase()
                                  .includes(search.toLowerCase()),
                              )
                              .map((r) => (
                                <tr key={r.id}>
                                  <td>
                                    <div className="history-document">
                                      <FileIcon report={r} />
                                      <div>
                                        <strong>{r.filename}</strong>
                                        <small>
                                          {reportType(r)} · {fmtSize(r.size)}
                                          {r.source === "demo"
                                            ? " · 合成示例"
                                            : ""}
                                        </small>
                                      </div>
                                    </div>
                                  </td>
                                  <td>{fmtDate(r.createdAt)}</td>
                                  <td>
                                    <Badge
                                      tone={
                                        r.status === "ready"
                                          ? "teal"
                                          : r.status === "processing"
                                            ? "blue"
                                            : "amber"
                                      }
                                    >
                                      {statusLabels[r.status] || r.status}
                                    </Badge>
                                  </td>
                                  <td>
                                    {r.candidateCount ??
                                      r.candidates?.length ??
                                      0}{" "}
                                    项
                                  </td>
                                  <td>
                                    <Button
                                      small
                                      variant="ghost"
                                      onClick={() => openReport(r.id)}
                                      disabled={!!busy}
                                    >
                                      打开 <ArrowUpRight size={13} />
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="没有找到报告"
                        description={
                          search
                            ? "试试其他关键词，或清空搜索。"
                            : "导入报告后，你的研究记录会显示在这里。"
                        }
                        icon={FolderClock}
                      />
                    )}
                  </section>
                  {activity.length > 0 && (
                    <section className="view-card">
                      <div className="view-card-head">
                        <div>
                          <h2>最近活动</h2>
                          <p>只记录操作元数据，不记录原始文本或密钥</p>
                        </div>
                        <History size={18} color="#8ba18b" />
                      </div>
                      {activity.slice(0, 8).map((a, i) => (
                        <div key={a.id || i} className="annotation-item">
                          <Clock3 size={13} />
                          <div className="annotation-text">
                            {historyLabel(a.action)}
                            <small>{fmtDate(a.createdAt)}</small>
                          </div>
                          {a.reportId && (
                            <button
                              className="icon-button"
                              aria-label="打开活动关联报告"
                              onClick={() => openReport(a.reportId)}
                            >
                              <ArrowUpRight size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </section>
                  )}
                </>
              )}
              {page === "templates" && (
                <>
                  <div className="alert info">
                    <Layers3 size={15} />
                    <span>
                      字段模板通过名称和别名匹配报告内容。应用模板只更新提取结果，原始报告始终保留。
                    </span>
                  </div>
                  <div className="cards-grid">
                    {templates.map((t) => (
                      <article className="template-card" key={t.id}>
                        <div className="template-top">
                          <div className="template-icon">
                            <Layers3 size={20} />
                          </div>
                          <div>
                            <h3>{t.name}</h3>
                            <p>
                              {t.domain || "通用研究"} · {t.fields.length}{" "}
                              个字段映射
                            </p>
                          </div>
                        </div>
                        <p className="template-description">
                          {t.fields
                            .slice(0, 3)
                            .map(
                              (f) =>
                                `${f.label}${f.aliases.length ? `（${f.aliases.slice(0, 2).join(" / ")}）` : ""}`,
                            )
                            .join("、")}
                          {t.fields.length > 3 ? " 等常用研究指标" : ""}
                        </p>
                        <div className="mapping-list">
                          {t.fields.slice(0, 8).map((f, i) => (
                            <span className="mapping-chip" key={i}>
                              {f.label}
                            </span>
                          ))}
                          {t.fields.length > 8 && (
                            <span className="mapping-chip">
                              +{t.fields.length - 8}
                            </span>
                          )}
                        </div>
                        <div className="template-footer">
                          <span>
                            {t.updatedAt
                              ? `更新于 ${fmtDate(t.updatedAt)}`
                              : "可复用字段映射"}
                          </span>
                          <div style={{ display: "flex", gap: 5 }}>
                            <button
                              className="icon-button"
                              aria-label={`删除模板 ${t.name}`}
                              onClick={() =>
                                askDelete("template", t.id, t.name)
                              }
                            >
                              <Trash2 size={13} />
                            </button>
                            <Button
                              small
                              variant="ghost"
                              onClick={() => {
                                setEditTemplate(t);
                                setModal("template");
                              }}
                            >
                              <Pencil size={12} />
                              编辑模板
                            </Button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!templates.length && (
                    <div className="view-card">
                      <Empty
                        title="建立你的第一套字段模板"
                        description="为指标设置名称、别名和单位，让相似报告快速完成结构化提取。"
                        icon={Layers3}
                      />
                    </div>
                  )}
                </>
              )}
              {page === "rules" && (
                <section className="view-card">
                  <div className="view-card-head">
                    <div>
                      <h2>研究判定规则</h2>
                      <p>
                        数值规则会核对单位。无法安全换算或证据不足时，结果标为待复核。
                      </p>
                    </div>
                    <Badge tone="teal">
                      {rules.filter((r) => r.enabled !== false).length}{" "}
                      条规则已启用
                    </Badge>
                  </div>
                  <div className="rules-list">
                    {rules.map((r) => (
                      <div className="rule-card" key={r.id}>
                        <div className="rule-symbol">
                          {r.kind === "qualitative" ? (
                            <Tag size={17} />
                          ) : (
                            <Activity size={17} />
                          )}
                        </div>
                        <div className="rule-body">
                          <h3>
                            {r.name}
                            <Badge
                              tone={r.kind === "qualitative" ? "blue" : "teal"}
                            >
                              {r.kind === "numeric"
                                ? "数值区间"
                                : r.kind === "qualitative"
                                  ? "定性结果"
                                  : "参考范围"}
                            </Badge>
                          </h3>
                          <p>
                            {r.label}{" "}
                            {r.kind === "qualitative"
                              ? `· 正常：${arrayText(r.normalValues) || "未设定"} · 异常：${arrayText(r.abnormalValues) || "未设定"}`
                              : `· ${r.low ?? "−∞"} 至 ${r.high ?? "+∞"} ${r.unit || "（按报告单位）"}`}{" "}
                            · {r.domain || "通用"}
                          </p>
                        </div>
                        <button
                          role="switch"
                          aria-checked={r.enabled !== false}
                          aria-label={`${r.enabled !== false ? "停用" : "启用"} ${r.name}`}
                          className={`switch ${r.enabled !== false ? "on" : ""}`}
                          disabled={!!busy}
                          onClick={() =>
                            run("toggle", async () => {
                              await api(`/rules/${r.id}`, {
                                method: "PUT",
                                body: json({
                                  name: r.name,
                                  label: r.label,
                                  aliases: r.aliases || [],
                                  kind: r.kind,
                                  unit: r.unit || "",
                                  low: r.low,
                                  high: r.high,
                                  normalValues: r.normalValues || [],
                                  abnormalValues: r.abnormalValues || [],
                                  domain: r.domain || "",
                                  enabled: r.enabled === false,
                                }),
                              });
                              await refreshLists();
                              notify(
                                r.enabled === false
                                  ? "规则已启用，报告可重新判定"
                                  : "规则已停用，报告可重新判定",
                              );
                            })
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label={`编辑规则 ${r.name}`}
                          onClick={() => {
                            setEditRule(r);
                            setModal("rule");
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`删除规则 ${r.name}`}
                          onClick={() => askDelete("rule", r.id, r.name)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {!rules.length && (
                    <Empty
                      title="还没有判定规则"
                      description="添加数值、定性或参考范围规则，为报告提供一致、可解释的复核依据。"
                      icon={SlidersHorizontal}
                    />
                  )}
                  <div className="fields-footnote">
                    <Info size={12} />
                    <span>
                      规则用于辅助整理研究资料，不适用于临床诊断。修改规则后，请回到报告点击「重新判定」更新结果。
                    </span>
                  </div>
                </section>
              )}
              {page === "settings" && config && (
                <SettingsView
                  config={config}
                  health={health}
                  busy={!!busy}
                  onSave={(data) =>
                    run("config", async () => {
                      const c = await api<Config>("/config", {
                        method: "PUT",
                        body: json(data),
                      });
                      setConfig(c);
                      notify("研究与模型设置已保存");
                    })
                  }
                />
              )}
            </>
          )}
          <div className="bottom-note">
            <ShieldCheck size={10} />
            本地解析 · 证据可追溯 · 研究辅助工具，不提供医疗诊断或治疗建议
          </div>
        </main>
      </div>
      {toast && (
        <div className={`toast ${toast.error ? "error" : ""}`} role="status">
          {toast.error ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}{" "}
          {toast.text}
        </div>
      )}
      {modal === "field" && report && (
        <FieldModal
          field={editField}
          anchors={anchors}
          focused={focused}
          busy={!!busy}
          onClose={() => setModal(null)}
          onSave={(data) =>
            run("field", async () => {
              const r = await api<Report>(`/reports/${report.id}/annotations`, {
                method: "POST",
                body: json(data),
              });
              updateReport(r);
              setModal(null);
              notify("人工标注已保存，原文保持不变");
            })
          }
        />
      )}
      {modal === "template" && (
        <TemplateModal
          template={editTemplate}
          domain={config?.domain || ""}
          busy={!!busy}
          onClose={() => setModal(null)}
          onSave={(data) =>
            run("template", async () => {
              await api(
                `/templates${editTemplate?.id ? `/${editTemplate.id}` : ""}`,
                { method: editTemplate?.id ? "PUT" : "POST", body: json(data) },
              );
              await refreshLists();
              setModal(null);
              notify("字段模板已保存");
            })
          }
        />
      )}
      {modal === "rule" && (
        <RuleModal
          rule={editRule}
          domain={config?.domain || ""}
          busy={!!busy}
          onClose={() => setModal(null)}
          onSave={(data) =>
            run("rule", async () => {
              await api(`/rules${editRule?.id ? `/${editRule.id}` : ""}`, {
                method: editRule?.id ? "PUT" : "POST",
                body: json(data),
              });
              await refreshLists();
              setModal(null);
              notify("判定规则已保存，报告可重新判定");
            })
          }
        />
      )}
      {modal === "apply" && report && (
        <ApplyModal
          templates={templates}
          busy={!!busy}
          onClose={() => setModal(null)}
          onApply={(id) =>
            run("apply", async () => {
              const r = await api<Report>(
                `/reports/${report.id}/apply-template`,
                { method: "POST", body: json({ templateId: id }) },
              );
              updateReport(r);
              setModal(null);
              setTab("fields");
              notify("字段模板已应用，请复核匹配结果");
            })
          }
        />
      )}
      {modal === "preview" && preview && (
        <Modal
          wide
          title="审核证据，再开始分析"
          subtitle="仅使用你选择的片段。请逐条检查脱敏结果，确认后才会启动分析。"
          onClose={() => !busy && setModal(null)}
          footer={
            <>
              <Button onClick={() => setModal(null)} disabled={!!busy}>
                返回核对
              </Button>
              <Button
                variant="primary"
                onClick={analyze}
                disabled={!consent || !!busy}
              >
                {busy === "analyze" ? (
                  <Loader2 size={14} className="spinner" />
                ) : (
                  <Sparkles size={14} />
                )}{" "}
                {busy === "analyze"
                  ? "分析中，请稍候"
                  : preview.mode === "mock"
                    ? "开始本地模拟分析"
                    : "确认发送并分析"}
              </Button>
            </>
          }
        >
          <div className="preview-provider">
            <strong>
              {preview.mode === "mock"
                ? "本地模拟 · 无外部传输"
                : `实时模型 · ${preview.model}`}
            </strong>
            <Badge tone={preview.mode === "mock" ? "blue" : "amber"}>
              {preview.mode === "mock" ? "MOCK" : "LIVE"}
            </Badge>
          </div>
          <div className={`alert ${preview.mode === "mock" ? "info" : ""}`}>
            <ShieldCheck size={15} />
            <div>
              {preview.mode === "mock" ? (
                "当前仅运行本地模拟，用于验证工作流程，不会联系任何外部模型。"
              ) : (
                <>
                  接收方：{preview.endpoint}
                  <br />
                  模型：{preview.model}
                  。证据片段将发送至该服务，请确认你有权共享这些内容。
                </>
              )}
              <br />
              自动脱敏不能保证移除全部身份信息，请人工检查。预览有效期至{" "}
              {fmtDate(preview.expiresAt)}。
            </div>
          </div>
          {preview.warnings?.map((w, i) => (
            <div key={i} className="alert">
              <AlertTriangle size={13} />
              {w}
            </div>
          ))}
          <h3 className="form-section-title">
            <Eye size={14} />
            {preview.payload ? "完整请求载荷预览" : "将用于分析的全部证据片段"}
          </h3>
          <pre className="raw-pre">
            {JSON.stringify(preview.payload || preview.excerpts, null, 2)}
          </pre>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={!!busy}
            />
            <span>
              {preview.mode === "mock"
                ? "我已核对使用方式及以上所有片段，确认已移除敏感身份信息，同意使用这些片段进行本地模拟分析。"
                : `我已检查以上完整内容，确认敏感身份信息已移除，并同意将这些片段发送到 ${preview.endpoint}（${preview.model}）用于本次研究分析。`}{" "}
              分析仅辅助研究，不构成医疗诊断。
            </span>
          </label>
        </Modal>
      )}
      {modal === "export" && report && (
        <Modal
          title="导出研究报告"
          subtitle="包含结构化字段、判定依据与证据锚点。请注意导出文件可能包含原始报告中的个人信息。"
          onClose={() => setModal(null)}
        >
          <div className="rules-list">
            {[
              {
                format: "html",
                title: "可打印报告",
                desc: "独立 HTML 文件，可在浏览器打印为 PDF",
                icon: FileText,
              },
              {
                format: "csv",
                title: "字段数据表",
                desc: "CSV 格式，适用于 Excel 与进一步统计分析",
                icon: Grip,
              },
              {
                format: "json",
                title: "完整结构化数据",
                desc: "JSON 格式，保留证据、标注与分析记录",
                icon: Layers3,
              },
            ].map(({ format, title, desc, icon: Icon }) => (
              <button
                className="rule-card"
                key={format}
                onClick={() =>
                  run("export", async () => {
                    await downloadReport(report.id, format, report.filename);
                    notify("报告已导出到下载目录");
                  })
                }
                disabled={!!busy}
                style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              >
                <span className="rule-symbol">
                  <Icon size={18} />
                </span>
                <span className="rule-body">
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </span>
                <Download size={16} color="#8ca87b" />
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "delete" && deleteTarget && (
        <Modal
          title={`删除${deleteTarget.kind === "template" ? "字段模板" : deleteTarget.kind === "rule" ? "判定规则" : "人工标注"}？`}
          onClose={() => setModal(null)}
          footer={
            <>
              <Button onClick={() => setModal(null)} disabled={!!busy}>
                保留
              </Button>
              <Button variant="danger" onClick={remove} disabled={!!busy}>
                <Trash2 size={13} />
                确认删除
              </Button>
            </>
          }
        >
          <p className="delete-confirm">
            将删除「{deleteTarget.label}」。原始报告文件不会受到影响。
            {deleteTarget.kind === "annotation"
              ? "相关字段将重新提取。"
              : "已保存的研究记录会保留。"}
            该操作无法在此界面撤销。
          </p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="让每项发现都能回到证据"
          subtitle="医疗报告分析 · med-report 使用指南"
          onClose={() => setModal(null)}
        >
          <div className="rules-list">
            {[
              {
                n: "01",
                title: "导入与提取",
                text: "上传 PDF、Word 或图片。在本地后台提取文本；扫描件使用 OCR。低置信度结果始终需要人工复核。",
              },
              {
                n: "02",
                title: "核对与整理",
                text: "点击指标旁的页码锚点查看原文；勾选原文片段，或添加人工字段与标注。模板提供可复用的字段别名映射。",
              },
              {
                n: "03",
                title: "规则与分析",
                text: "数值和定性规则给出可解释的参考判定。AI 只在你选择片段、核对脱敏预览并确认后运行，默认采用本地模拟。",
              },
              {
                n: "04",
                title: "保存与导出",
                text: "报告、标注和结果自动保存到本地资料库。支持 HTML、CSV 与 JSON 导出；HTML 可通过浏览器打印为 PDF。",
              },
            ].map((x) => (
              <div className="rule-card" key={x.n}>
                <span className="rule-symbol" style={{ fontSize: 11 }}>
                  {x.n}
                </span>
                <div className="rule-body">
                  <h3>{x.title}</h3>
                  <p>{x.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div
            className="alert info"
            style={{ marginTop: 20, marginBottom: 0 }}
          >
            <Info size={14} />
            本工具用于研究资料整理与辅助分析，不作诊断，不提供治疗建议，也不替代专业医疗判断。
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  icon: Icon,
  color = "",
  label,
  value,
  unit,
  note,
}: {
  icon: typeof FileText;
  color?: string;
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${color}`}>
        <Icon size={19} />
      </div>
      <div className="stat-content">
        <div className="stat-label">{label}</div>
        <div className="stat-number">
          {value}
          <small>{unit}</small>
        </div>
      </div>
      <div className="stat-tag">
        <i className="status-dot" />
        {note}
      </div>
    </div>
  );
}
function Evidence({
  report,
  selected,
  focused,
  onToggle,
  onFocus,
  onAnnotate,
  onClear,
  onSelectAll,
  maxSelected,
}: {
  report: Report | null;
  selected: string[];
  focused: string;
  maxSelected: number;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onAnnotate: (id: string) => void;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  const anchors = report?.anchors || [];
  return (
    <>
      <div className="panel-header">
        <h3>
          <BookOpen size={13} />
          原文证据
        </h3>
        <div className="evidence-toolbar">
          {selected.length > 0 ? (
            <button className="anchor-button" onClick={onClear}>
              清空选择
            </button>
          ) : (
            <button
              className="anchor-button"
              onClick={onSelectAll}
              disabled={!anchors.length}
            >
              {anchors.length > maxSelected
                ? `选择前 ${maxSelected} 项`
                : "选择全部"}
            </button>
          )}
          <span className="caption">
            {getPages(report || { anchors: [] }) || "—"} 页 · {anchors.length}{" "}
            个片段
          </span>
        </div>
      </div>
      {anchors.length ? (
        <div className="evidence-page">
          <div className="evidence-doc-title">
            {report?.source === "demo"
              ? "研究示例 · 检验报告"
              : "报告原文 · 证据片段"}
          </div>
          {anchors.map((a) => (
            <div
              id={`anchor-${a.id}`}
              key={a.id}
              className={`evidence-line ${selected.includes(a.id) ? "selected" : ""} ${focused === a.id ? "focused" : ""}`}
              onClick={() => onFocus(a.id)}
            >
              <input
                type="checkbox"
                checked={selected.includes(a.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggle(a.id)}
                aria-label={`选择第 ${a.page} 页第 ${a.line} 行`}
              />
              <span className="line-number">
                {a.page}:{String(a.line).padStart(2, "0")}
              </span>
              <span className="line-text">{a.text}</span>
              {focused === a.id && (
                <button
                  className="icon-button"
                  title="为此行添加标注"
                  aria-label="为此行添加标注"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnnotate(a.id);
                  }}
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title={
            report?.status === "processing" ? "正在提取原文" : "暂无可用原文"
          }
          description="解析后的每段证据都会标注页码与行号。"
          icon={FileSearch}
        />
      )}
      <div className="evidence-foot">
        <span>
          <Link2 size={9} style={{ verticalAlign: "middle", marginRight: 4 }} />
          点击指标锚点定位原文 · 勾选用于分析
        </span>
        <span>
          {selected.length} / {maxSelected} 个已选
        </span>
      </div>
    </>
  );
}
function AnalysisView({
  analysis,
  onEvidence,
  onAnalyze,
  selectedCount,
  config,
}: {
  analysis: Report["analysis"];
  onEvidence: (id: string) => void;
  onAnalyze: () => void;
  selectedCount: number;
  config: Config | null;
}) {
  if (!analysis)
    return (
      <Empty
        title="把可靠证据，整理成研究线索"
        description={`先在原文中勾选证据片段，再核对脱敏预览。${config?.mode === "mock" ? "当前为本地模拟模式，不会调用外部服务。" : "实时分析将仅发送经你审核的脱敏内容。"}`}
        icon={Sparkles}
      >
        <Button small variant="soft" onClick={onAnalyze}>
          <Sparkles size={13} />
          {selectedCount
            ? `审核 ${selectedCount} 个已选片段`
            : "选择证据并分析"}
        </Button>
      </Empty>
    );
  return (
    <div className="result-layout">
      <div>
        <h3 className="result-heading">
          <Sparkles size={15} />
          基于证据的研究摘要{" "}
          <Badge tone={analysis.mode === "mock" ? "blue" : "teal"}>
            {analysis.mode === "mock" ? "本地模拟输出" : "实时模型输出"}
          </Badge>
        </h3>
        <p className="analysis-summary">{analysis.summary}</p>
        <div className="result-findings">
          {analysis.findings.map((f, i) => (
            <div className="finding" key={i}>
              <h4>
                <span style={{ fontSize: 9, color: "#a0b18d" }}>0{i + 1}</span>{" "}
                证据线索
              </h4>
              <p>{f.text}</p>
              <div className="tag-row">
                {f.anchorIds.map((id) => (
                  <button
                    className="anchor-button"
                    key={id}
                    onClick={() => onEvidence(id)}
                  >
                    <Link2 size={10} />
                    {id.replace("p", "P").replace("-l", ":")}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {analysis.limitations?.length > 0 && (
          <div className="alert" style={{ margin: "18px 0 0" }}>
            <AlertTriangle size={14} />
            <div>
              {analysis.limitations.map((s, i) => (
                <p key={i}>{s}</p>
              ))}
            </div>
          </div>
        )}
      </div>
      <aside className="result-metadata">
        <h4>分析记录</h4>
        <dl>
          <dt>运行模式</dt>
          <dd>
            {analysis.mode === "mock" ? "Mock · 本地模拟" : "Live · 远程模型"}
          </dd>
          <dt>模型</dt>
          <dd>{analysis.model}</dd>
          <dt>研究领域</dt>
          <dd>{analysis.domain || "未指定"}</dd>
          <dt>背景信息</dt>
          <dd>{analysis.diseaseContext || "未提供额外背景"}</dd>
          <dt>证据片段</dt>
          <dd>{analysis.selectedAnchorIds.length} 个</dd>
          <dt>生成时间</dt>
          <dd>{fmtDate(analysis.createdAt)}</dd>
        </dl>
      </aside>
    </div>
  );
}
function historyLabel(action: string) {
  const labels: Record<string, string> = {
    upload: "导入研究报告",
    extract: "完成报告解析",
    extraction: "完成报告解析",
    analyze: "生成研究分析",
    analysis: "生成研究分析",
    annotation: "保存人工标注",
    annotate: "保存人工标注",
    apply_template: "应用字段模板",
    evaluate: "重新进行规则判定",
    demo: "加载合成示例",
    create: "创建报告",
    export: "导出报告",
    delete_annotation: "删除人工标注",
    report_uploaded: "导入研究报告",
    extraction_completed: "完成本地解析",
    extraction_failed: "本地解析失败",
    demo_created: "创建合成示例",
    annotation_added: "保存人工标注",
    annotation_removed: "删除人工标注",
    template_applied: "应用字段模板",
    rules_evaluated: "完成规则判定",
    ai_preview_created: "生成脱敏证据预览",
    mock_analysis_completed: "完成本地模拟分析",
    live_analysis_completed: "完成实时模型分析",
    configuration_updated: "更新研究与模型设置",
    template_saved: "保存字段模板",
    template_deleted: "删除字段模板",
    rule_saved: "保存判定规则",
    rule_deleted: "删除判定规则",
  };
  return labels[action] || action;
}
function FieldModal({
  field,
  anchors,
  focused,
  busy,
  onClose,
  onSave,
}: {
  field: Candidate | null;
  anchors: Anchor[];
  focused: string;
  busy: boolean;
  onClose: () => void;
  onSave: (data: unknown) => void;
}) {
  const [anchorId, setAnchorId] = useState(
    field?.anchorIds?.[0] || focused || anchors[0]?.id || "",
  );
  const [label, setLabel] = useState(field?.label || "");
  const [value, setValue] = useState(String(field?.value ?? ""));
  const [unit, setUnit] = useState(field?.unit || "");
  const [low, setLow] = useState(field?.referenceRange?.low?.toString() || "");
  const [high, setHigh] = useState(
    field?.referenceRange?.high?.toString() || "",
  );
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");
  const save = () => {
    if (!anchorId || !label.trim() || !value.trim()) {
      setValidation("请填写指标名称、检测结果，并选择一条原文证据");
      return;
    }
    if (low && high && Number(low) > Number(high)) {
      setValidation("参考下限不能高于上限");
      return;
    }
    onSave({
      anchorId,
      label: label.trim(),
      value: /^-?\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value.trim())
        : value.trim(),
      unit: unit.trim(),
      ...(low !== "" ? { referenceLow: Number(low) } : {}),
      ...(high !== "" ? { referenceHigh: Number(high) } : {}),
      note: note.trim(),
    });
  };
  return (
    <Modal
      title={field ? "人工核对指标" : "补充研究字段"}
      subtitle="人工修改会形成可追溯标注，不会改写原始文本。请依据原文填写。"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            <Save size={13} />
            保存标注
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group full">
          <label htmlFor="field-anchor">原文证据</label>
          <select
            id="field-anchor"
            value={anchorId}
            onChange={(e) => setAnchorId(e.target.value)}
          >
            {anchors.map((a) => (
              <option key={a.id} value={a.id}>
                P{a.page}:{a.line} · {a.text.slice(0, 85)}
              </option>
            ))}
          </select>
          <p className="form-help">
            {anchors.find((a) => a.id === anchorId)?.text}
          </p>
        </div>
        <div className="form-group">
          <label htmlFor="field-label">指标名称 *</label>
          <input
            id="field-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：白细胞计数"
            maxLength={80}
          />
        </div>
        <div className="form-group">
          <label htmlFor="field-value">检测结果 *</label>
          <input
            id="field-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="数值或定性结果"
            maxLength={99}
          />
        </div>
        <div className="form-group">
          <label htmlFor="field-unit">单位</label>
          <input
            id="field-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="例如：10^9/L"
            maxLength={40}
          />
        </div>
        <div className="form-group">
          <label>参考范围</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="参考范围下限"
              type="number"
              step="any"
              value={low}
              onChange={(e) => setLow(e.target.value)}
              placeholder="下限"
            />
            <input
              aria-label="参考范围上限"
              type="number"
              step="any"
              value={high}
              onChange={(e) => setHigh(e.target.value)}
              placeholder="上限"
            />
          </div>
        </div>
        <div className="form-group full">
          <label htmlFor="field-note">核对备注</label>
          <textarea
            id="field-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="补充该指标的核对依据或不确定性…"
            rows={3}
            maxLength={1000}
          />
        </div>
      </div>
      {field && (
        <div className="alert info" style={{ marginTop: 18, marginBottom: 0 }}>
          <Info size={13} />
          <span>
            当前判定：{candidateLabels[field.status] || field.status}。
            {field.reason} 提取置信度：
            {confidenceLabels[field.confidence] || field.confidence}。
          </span>
        </div>
      )}
      {validation && (
        <div className="alert error" style={{ marginTop: 15, marginBottom: 0 }}>
          <AlertCircle size={13} />
          {validation}
        </div>
      )}
    </Modal>
  );
}
function TemplateModal({
  template,
  domain,
  busy,
  onClose,
  onSave,
}: {
  template: Template | null;
  domain: string;
  busy: boolean;
  onClose: () => void;
  onSave: (data: unknown) => void;
}) {
  const [name, setName] = useState(template?.name || "");
  const [formDomain, setDomain] = useState(template?.domain || domain);
  const [fields, setFields] = useState(
    template?.fields.length
      ? template.fields.map((f) => ({
          label: f.label,
          aliases: f.aliases.join("、"),
          unit: f.unit || "",
        }))
      : [{ label: "", aliases: "", unit: "" }],
  );
  const [validation, setValidation] = useState("");
  const change = (i: number, key: string, value: string) =>
    setFields((fs) => fs.map((f, j) => (i === j ? { ...f, [key]: value } : f)));
  const save = () => {
    const clean = fields
      .filter((f) => f.label.trim())
      .map((f) => ({
        label: f.label.trim(),
        aliases: splitText(f.aliases),
        unit: f.unit.trim(),
      }));
    if (!name.trim() || !clean.length) {
      setValidation("请填写模板名称，并添加至少一个字段");
      return;
    }
    onSave({ name: name.trim(), domain: formDomain.trim(), fields: clean });
  };
  return (
    <Modal
      wide
      title={template?.id ? "编辑字段模板" : "创建字段模板"}
      subtitle="字段名称为统一名称，别名用于匹配原文中不同的写法。多个别名可用逗号分隔。"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            <Save size={13} />
            保存模板
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="template-name">模板名称 *</label>
          <input
            id="template-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：常规血液检验研究"
            maxLength={80}
          />
        </div>
        <div className="form-group">
          <label htmlFor="template-domain">适用领域</label>
          <input
            id="template-domain"
            value={formDomain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="例如：检验医学"
            maxLength={100}
          />
        </div>
      </div>
      <h3 className="form-section-title" style={{ marginTop: 24 }}>
        <Layers3 size={14} />
        字段映射
      </h3>
      <div className="mappings-editor">
        <div className="mapping-edit-row mapping-edit-labels">
          <span>标准字段名称 *</span>
          <span>原文别名（逗号分隔）</span>
          <span>默认单位</span>
          <span />
        </div>
        {fields.map((f, i) => (
          <div className="mapping-edit-row" key={i}>
            <input
              aria-label={`字段 ${i + 1} 名称`}
              value={f.label}
              onChange={(e) => change(i, "label", e.target.value)}
              placeholder="指标名称"
              maxLength={80}
            />
            <input
              aria-label={`字段 ${i + 1} 别名`}
              value={f.aliases}
              onChange={(e) => change(i, "aliases", e.target.value)}
              placeholder="例如：WBC、白细胞"
              maxLength={400}
            />
            <input
              aria-label={`字段 ${i + 1} 单位`}
              value={f.unit}
              onChange={(e) => change(i, "unit", e.target.value)}
              placeholder="单位"
              maxLength={40}
            />
            <button
              className="icon-button"
              aria-label={`移除字段 ${i + 1}`}
              onClick={() => setFields((fs) => fs.filter((_, j) => i !== j))}
              disabled={fields.length <= 1}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <Button
        small
        variant="ghost"
        onClick={() =>
          setFields((fs) => [...fs, { label: "", aliases: "", unit: "" }])
        }
        disabled={fields.length >= 100}
        style={{ marginTop: 12 }}
      >
        <Plus size={13} />
        添加字段
      </Button>
      {validation && (
        <div className="alert error" style={{ marginTop: 15, marginBottom: 0 }}>
          <AlertCircle size={13} />
          {validation}
        </div>
      )}
    </Modal>
  );
}
function RuleModal({
  rule,
  domain,
  busy,
  onClose,
  onSave,
}: {
  rule: Rule | null;
  domain: string;
  busy: boolean;
  onClose: () => void;
  onSave: (data: unknown) => void;
}) {
  const [name, setName] = useState(rule?.name || "");
  const [label, setLabel] = useState(rule?.label || "");
  const [kind, setKind] = useState<Rule["kind"]>(rule?.kind || "numeric");
  const [aliases, setAliases] = useState(arrayText(rule?.aliases));
  const [unit, setUnit] = useState(rule?.unit || "");
  const [low, setLow] = useState(rule?.low?.toString() || "");
  const [high, setHigh] = useState(rule?.high?.toString() || "");
  const [normal, setNormal] = useState(arrayText(rule?.normalValues));
  const [abnormal, setAbnormal] = useState(arrayText(rule?.abnormalValues));
  const [formDomain, setDomain] = useState(rule?.domain || domain);
  const [enabled, setEnabled] = useState(rule?.enabled !== false);
  const [validation, setValidation] = useState("");
  const save = () => {
    if (!name.trim() || !label.trim()) {
      setValidation("请填写规则名称和目标指标");
      return;
    }
    if (kind !== "qualitative" && !low && !high) {
      setValidation("请至少设置一个边界值");
      return;
    }
    if (low && high && Number(low) > Number(high)) {
      setValidation("下限不能高于上限");
      return;
    }
    if (
      kind === "qualitative" &&
      !splitText(normal).length &&
      !splitText(abnormal).length
    ) {
      setValidation("请至少填写一种正常或异常结果");
      return;
    }
    onSave({
      name: name.trim(),
      label: label.trim(),
      aliases: splitText(aliases),
      kind,
      unit: unit.trim(),
      ...(kind !== "qualitative" && low !== "" ? { low: Number(low) } : {}),
      ...(kind !== "qualitative" && high !== "" ? { high: Number(high) } : {}),
      normalValues: kind === "qualitative" ? splitText(normal) : [],
      abnormalValues: kind === "qualitative" ? splitText(abnormal) : [],
      enabled,
      domain: formDomain.trim(),
    });
  };
  return (
    <Modal
      title={rule ? "编辑判定规则" : "创建判定规则"}
      subtitle="为研究资料定义可解释的判定条件。请根据研究目的与适用人群设置。"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} disabled={busy}>
            <Save size={13} />
            保存规则
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group full">
          <label htmlFor="rule-name">规则名称 *</label>
          <input
            id="rule-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：白细胞计数参考区间"
            maxLength={100}
          />
        </div>
        <div className="form-group">
          <label htmlFor="rule-label">目标指标 *</label>
          <input
            id="rule-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例如：白细胞计数"
            maxLength={80}
          />
        </div>
        <div className="form-group">
          <label htmlFor="rule-kind">判定类型</label>
          <select
            id="rule-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as Rule["kind"])}
          >
            <option value="numeric">数值区间</option>
            <option value="qualitative">定性结果</option>
            <option value="range">参考范围</option>
          </select>
        </div>
        <div className="form-group full">
          <label htmlFor="rule-aliases">匹配别名</label>
          <input
            id="rule-aliases"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="例如：WBC、白细胞（逗号分隔）"
            maxLength={400}
          />
        </div>
        {kind === "qualitative" ? (
          <>
            <div className="form-group">
              <label htmlFor="rule-normal">正常结果</label>
              <input
                id="rule-normal"
                value={normal}
                onChange={(e) => setNormal(e.target.value)}
                placeholder="例如：阴性、未检出"
                maxLength={400}
              />
            </div>
            <div className="form-group">
              <label htmlFor="rule-abnormal">异常结果</label>
              <input
                id="rule-abnormal"
                value={abnormal}
                onChange={(e) => setAbnormal(e.target.value)}
                placeholder="例如：阳性、检出"
                maxLength={400}
              />
            </div>
          </>
        ) : (
          <>
            <div className="form-group">
              <label>参考范围（包含边界）</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  aria-label="规则下限"
                  type="number"
                  step="any"
                  value={low}
                  onChange={(e) => setLow(e.target.value)}
                  placeholder="下限"
                />
                <input
                  aria-label="规则上限"
                  type="number"
                  step="any"
                  value={high}
                  onChange={(e) => setHigh(e.target.value)}
                  placeholder="上限"
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="rule-unit">规则单位</label>
              <input
                id="rule-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="例如：mmol/L"
                maxLength={40}
              />
              <p className="form-help">无法安全换算的单位会触发待复核</p>
            </div>
          </>
        )}
        <div className="form-group full">
          <label htmlFor="rule-domain">适用领域</label>
          <input
            id="rule-domain"
            value={formDomain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="例如：检验医学"
            maxLength={100}
          />
        </div>
      </div>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>启用此规则。规则更改后，需对已有报告执行「重新判定」。</span>
      </label>
      {validation && (
        <div className="alert error" style={{ marginTop: 15, marginBottom: 0 }}>
          <AlertCircle size={13} />
          {validation}
        </div>
      )}
    </Modal>
  );
}
function ApplyModal({
  templates,
  busy,
  onClose,
  onApply,
}: {
  templates: Template[];
  busy: boolean;
  onClose: () => void;
  onApply: (id: string) => void;
}) {
  const [id, setId] = useState(templates[0]?.id || "");
  const t = templates.find((t) => t.id === id);
  return (
    <Modal
      title="应用字段模板"
      subtitle="按照所选模板匹配当前报告，已保存的人工标注仍会保留。"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => onApply(id)}
            disabled={busy || !id}
          >
            <Layers3 size={13} />
            应用模板
          </Button>
        </>
      }
    >
      <div className="form-group">
        <label htmlFor="apply-template">选择模板</label>
        <select
          id="apply-template"
          value={id}
          onChange={(e) => setId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.fields.length} 个字段
            </option>
          ))}
        </select>
      </div>
      {t && (
        <div
          className="mapping-list"
          style={{ marginTop: 20, marginBottom: 0 }}
        >
          {t.fields.map((f, i) => (
            <span className="mapping-chip" key={i}>
              {f.label}
              {f.unit ? ` · ${f.unit}` : ""}
            </span>
          ))}
        </div>
      )}
    </Modal>
  );
}
function SettingsView({
  config,
  health,
  busy,
  onSave,
}: {
  config: Config;
  health: Health | null;
  busy: boolean;
  onSave: (data: Partial<Config>) => void;
}) {
  const [domain, setDomain] = useState(config.domain);
  const [diseaseContext, setContext] = useState(config.diseaseContext);
  const [mode, setMode] = useState(config.mode);
  const [model, setModel] = useState(config.model);
  const capabilities = health?.capabilities;
  const changed =
    domain !== config.domain ||
    diseaseContext !== config.diseaseContext ||
    mode !== config.mode ||
    model !== config.model;
  return (
    <>
      <div className="settings-grid">
        <section className="view-card">
          <div className="view-card-head">
            <div>
              <h2>研究背景</h2>
              <p>补充分析领域与研究关注点，为结果提供必要语境</p>
            </div>
            <Stethoscope size={20} color="#829e85" />
          </div>
          <div className="form-grid">
            <div className="form-group full">
              <label htmlFor="settings-domain">专业领域</label>
              <input
                id="settings-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="例如：检验医学、代谢研究"
                maxLength={100}
              />
            </div>
            <div className="form-group full">
              <label htmlFor="settings-context">疾病 / 研究背景</label>
              <textarea
                id="settings-context"
                value={diseaseContext}
                onChange={(e) => setContext(e.target.value)}
                placeholder="描述需要关注的研究背景。避免填写姓名、身份证号、电话等身份信息。"
                rows={6}
                maxLength={1000}
              />
              <p className="form-help">
                背景信息保存在本地。仅经服务器允许的临床关键词可能用于模型请求，最终内容会在分析预览中完整展示。
              </p>
            </div>
          </div>
        </section>
        <section className="view-card">
          <div className="view-card-head">
            <div>
              <h2>模型运行方式</h2>
              <p>默认不连接外部模型，每次实时调用均需独立确认</p>
            </div>
            <Sparkles size={19} color="#829e85" />
          </div>
          <div className="form-group">
            <label>运行模式</label>
            <div className="mode-choice">
              <button
                className={mode === "mock" ? "selected" : ""}
                onClick={() => setMode("mock")}
              >
                <ShieldCheck
                  size={16}
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                本地模拟
                <span>
                  验证完整流程
                  <br />
                  不会进行外部传输
                </span>
              </button>
              <button
                className={mode === "live" ? "selected" : ""}
                onClick={() => setMode("live")}
              >
                <Sparkles
                  size={16}
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                实时模型
                <span>
                  调用配置的模型服务
                  <br />
                  仅发送已确认的片段
                </span>
              </button>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 18 }}>
            <label htmlFor="settings-model">模型名称</label>
            <input
              id="settings-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={100}
            />
          </div>
          <div className="form-group" style={{ marginTop: 18 }}>
            <label>服务端点</label>
            <div
              className="raw-pre"
              style={{ fontSize: 9, padding: "10px 12px" }}
            >
              {config.endpoint}
            </div>
            <p className="form-help">
              端点与 API 密钥仅通过服务端环境变量配置，浏览器不接收或存储密钥。
            </p>
          </div>
          <div
            className="connection-status"
            style={{
              marginTop: 16,
              background: config.keyConfigured ? "" : "#faf7ef",
              color: config.keyConfigured ? "" : "#b09a70",
              borderColor: config.keyConfigured ? "" : "#eee6d3",
            }}
          >
            {config.keyConfigured ? (
              <CheckCircle2 size={13} />
            ) : (
              <LockKeyhole size={13} />
            )}{" "}
            {config.keyConfigured
              ? "服务端已配置 API 密钥"
              : "未配置 API 密钥 · 本地模拟可正常使用"}
          </div>
          {mode === "live" && !config.keyConfigured && (
            <p className="form-help" style={{ color: "#b29c70", marginTop: 9 }}>
              实时调用前，需在服务端设置 GLM_API_KEY 并重启服务。
            </p>
          )}
        </section>
      </div>
      <div className="view-card" style={{ marginTop: 0 }}>
        <div className="view-card-head">
          <div>
            <h2>本地解析能力</h2>
            <p>后台有界任务队列，适合 CPU 环境。解析能力由部署环境决定。</p>
          </div>
          <Badge tone={health?.ok ? "teal" : "amber"}>
            {health?.ok ? "服务运行正常" : "状态未知"}
          </Badge>
        </div>
        <div className="tag-row">
          {[
            { label: "PDF 文本提取", ready: capabilities?.pdftotext },
            { label: "PDF 页面渲染", ready: capabilities?.pdftoppm },
            { label: "图片 / 扫描件 OCR", ready: capabilities?.tesseract },
            { label: "旧版 Word DOC", ready: capabilities?.antiword },
          ].map((x) => (
            <Badge key={x.label} tone={x.ready ? "teal" : "amber"}>
              {x.ready ? <Check size={10} /> : <AlertCircle size={10} />}{" "}
              {x.label} · {x.ready ? "可用" : "未检测到"}
            </Badge>
          ))}
        </div>
        <p className="form-help" style={{ marginTop: 12 }}>
          OCR 语言：
          {Array.isArray(capabilities?.ocrLanguages)
            ? capabilities.ocrLanguages.join("、")
            : String(capabilities?.ocrLanguages || "未检测到")}
          。DOCX 使用本地文本提取，不需要远程服务。
        </p>
        {health?.limits && (
          <p className="form-help" style={{ marginTop: 8 }}>
            当前预算：{String(health.limits.concurrency ?? "—")} 个解析工作进程
            · OCR {String(health.limits.ocrThreads ?? "—")} 线程 · 每份最多{" "}
            {String(health.limits.maxPages ?? "—")} 页 / OCR{" "}
            {String(health.limits.maxOcrPages ?? "—")} 页 · 每次分析最多{" "}
            {String(health.limits.maxSelectedExcerpts ?? 40)} 个片段
          </p>
        )}
        <div className="form-actions">
          <Button
            onClick={() => {
              setDomain(config.domain);
              setContext(config.diseaseContext);
              setMode(config.mode);
              setModel(config.model);
            }}
            disabled={busy || !changed}
          >
            还原更改
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                domain: domain.trim(),
                diseaseContext: diseaseContext.trim(),
                mode,
                model: model.trim(),
              })
            }
            disabled={busy || !changed || !model.trim() || !domain.trim()}
          >
            <Save size={14} />
            保存设置
          </Button>
        </div>
      </div>
    </>
  );
}
