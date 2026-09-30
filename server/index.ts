import {
  fileConfig,
  createFilePreview,
  consumeFileConsent,
  DEFAULT_PARSING_MODE,
  validateCloudFile,
} from "./file-parser";
import { join, extname, resolve } from "node:path";
import { chmod, unlink } from "node:fs/promises";
import {
  all,
  get,
  put,
  remove,
  detail,
  saveReport,
  config,
  saveConfig,
  history,
  audit,
  rules,
  templates,
  FILE_DIR,
  ROOT,
} from "./db";
import type {
  Annotation,
  AppConfig,
  Report,
  Rule,
  Template,
  TemplateField,
} from "./types";
import { AppError, bad, str, finite, strings } from "./errors";
import {
  capabilities,
  LIMITS,
  verifyUpload,
  stopExtractionProcesses,
} from "./extract";
import { CATALOG, extractCandidates, normalize } from "./evaluate";
import {
  assertCapacity,
  enqueue,
  evaluate,
  findJob,
  queueState,
  recoverInterruptedJobs,
} from "./queue";
import { seed, createDemo } from "./seed";
import { AI_ENDPOINT, PRIVACY_WARNING, createPreview, analyze } from "./ai";
import { exportReport } from "./export";
import { openapi } from "./openapi";
import { sessions, sessionId, sessionCookie } from "./auth";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3001);
const TOKEN = process.env.APP_TOKEN || "";
if (
  !["127.0.0.1", "localhost", "::1"].includes(HOST) &&
  TOKEN.length < 16 &&
  process.env.CONTAINER_LOCAL_ONLY !== "1"
)
  throw new Error(
    "Non-loopback HOST requires APP_TOKEN of at least 16 characters. Use reverse proxy authentication and HTTPS for shared access.",
  );
const json = (obj: unknown, status = 200) => Response.json(obj, { status });
function keys(body: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(body))
    if (!allowed.includes(key))
      bad(`Unsupported field: ${key}`, "UNKNOWN_FIELD");
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") || "").includes("application/json"))
    throw new AppError(
      415,
      "JSON_REQUIRED",
      "Content-Type application/json required",
    );
  const raw = await req.text();
  if (raw.length > 100000)
    throw new AppError(413, "BODY_TOO_LARGE", "JSON request is too large");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    bad("Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    bad("Expected a JSON object");
  return value as Record<string, unknown>;
}
function requireReport(id: string) {
  const r = get<Report>("reports", id);
  if (!r) throw new AppError(404, "REPORT_NOT_FOUND", "Report not found");
  return r;
}
function mutableReport(id: string) {
  const r = requireReport(id);
  if (r.status === "processing")
    throw new AppError(
      409,
      "STILL_PROCESSING",
      "Wait for local extraction to finish",
    );
  return r;
}
function safeConfig() {
  return {
    ...config(),
    endpoint: AI_ENDPOINT,
    keyConfigured: !!process.env.GLM_API_KEY,
    privacyWarning: PRIVACY_WARNING,
  };
}
function verifyAccess(req: Request, url: URL) {
  const trustedOrigins = new Set([
    url.origin,
    ...(process.env.APP_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  ]);
  const trustedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.APP_ORIGIN || "")
      .split(",")
      .filter(Boolean)
      .flatMap((origin) => {
        try {
          return [new URL(origin).hostname];
        } catch {
          return [];
        }
      }),
  ]);
  if (!trustedHosts.has(url.hostname))
    throw new AppError(403, "INVALID_HOST", "Unrecognized Host");
  const origin = req.headers.get("origin");
  if (origin && !trustedOrigins.has(origin))
    throw new AppError(
      403,
      "ORIGIN_REJECTED",
      "Cross-origin requests are not allowed",
    );
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site")
    throw new AppError(
      403,
      "ORIGIN_REJECTED",
      "Cross-site requests are not allowed",
    );
}
function parseFields(value: unknown): TemplateField[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    bad("fields must contain 1–100 field mappings");
  return value.map((v) => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      bad("Invalid template field");
    const f = v as Record<string, unknown>;
    keys(f, ["label", "aliases", "unit"]);
    return {
      label: str(f.label, "label", 80),
      aliases: strings(f.aliases ?? [], "aliases"),
      unit: str(f.unit, "unit", 40, false),
    };
  });
}
function parseRule(input: Record<string, unknown>, existing?: Rule): Rule {
  keys(input, [
    "name",
    "label",
    "aliases",
    "kind",
    "unit",
    "low",
    "high",
    "normalValues",
    "abnormalValues",
    "enabled",
    "domain",
  ]);
  const now = new Date().toISOString();
  const kind = input.kind;
  if (!["numeric", "qualitative", "range"].includes(String(kind)))
    bad("kind must be numeric, qualitative or range");
  const low = finite(input.low, "low"),
    high = finite(input.high, "high");
  if (low !== undefined && high !== undefined && low > high)
    bad("low cannot exceed high");
  const normalValues = strings(input.normalValues ?? [], "normalValues"),
    abnormalValues = strings(input.abnormalValues ?? [], "abnormalValues");
  if (
    kind === "qualitative" &&
    normalValues.some((v) =>
      abnormalValues.some((a) => normalize(a) === normalize(v)),
    )
  )
    bad("Qualitative normalValues and abnormalValues cannot overlap");
  if (kind === "qualitative" && !normalValues.length && !abnormalValues.length)
    bad("Qualitative rule needs normalValues or abnormalValues");
  if (kind !== "qualitative" && low === undefined && high === undefined)
    bad("Numeric/range rule needs low or high");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    bad("enabled must be boolean");
  return {
    id: existing?.id || crypto.randomUUID(),
    name: str(input.name, "name"),
    label: str(input.label, "label", 80),
    aliases: strings(input.aliases ?? [], "aliases"),
    kind: kind as Rule["kind"],
    unit: str(input.unit, "unit", 40, false),
    low,
    high,
    normalValues,
    abnormalValues,
    enabled: input.enabled !== false,
    domain: str(input.domain, "domain", 100, false),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}
const inflightAnalysis = new Set<string>();
export async function handle(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url),
      path = url.pathname.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    verifyAccess(req, url);
    const segments = path.split("/").filter(Boolean),
      method = req.method;
    if (method === "OPTIONS") return new Response(null, { status: 204 });
    const cookieId = sessionId(req);
    if (path === "/api/auth/session" && method === "GET") {
      const authenticated = sessions.valid(cookieId);
      return json({
        authenticated,
        username: authenticated ? "admin" : null,
        demo: true,
      });
    }
    if (path === "/api/auth/login" && method === "POST") {
      const input = await body(req);
      keys(input, ["username", "password"]);
      if (input.username !== "admin" || input.password !== "admin")
        throw new AppError(
          401,
          "INVALID_CREDENTIALS",
          "Incorrect demo username or password",
        );
      const id = sessions.create(cookieId);
      const response = json({
        authenticated: true,
        username: "admin",
        demo: true,
      });
      response.headers.set("Set-Cookie", sessionCookie(req, id));
      return response;
    }
    if (path === "/api/auth/logout" && method === "POST") {
      sessions.revoke(cookieId);
      const response = json({ ok: true });
      response.headers.set("Set-Cookie", sessionCookie(req, "", true));
      return response;
    }
    if (
      path.startsWith("/api/") &&
      path !== "/api/health" &&
      !sessions.valid(cookieId) &&
      !(TOKEN && req.headers.get("authorization") === `Bearer ${TOKEN}`)
    )
      throw new AppError(
        401,
        "UNAUTHORIZED",
        "Sign in to the local demo first",
      );
    if (path === "/api/health" && method === "GET")
      return json({
        ok: true,
        version: "1.0.0",
        mode: config().mode,
        capabilities: await capabilities(),
        limits: LIMITS,
        queue: queueState(),
      });
    if (path === "/api/parsing" && method === "GET") return json(fileConfig());
    if (path === "/api/parsing/preview" && method === "POST") {
      const input = await body(req);
      keys(input, ["mode", "filename", "size", "sha256"]);
      return json(createFilePreview(input, cookieId || "bearer"));
    }
    if (path === "/api/config") {
      if (method === "GET") return json(safeConfig());
      if (method === "PUT") {
        const input = await body(req);
        keys(input, ["mode", "model", "domain", "diseaseContext"]);
        if (
          input.mode !== undefined &&
          !["mock", "live"].includes(String(input.mode))
        )
          bad("mode must be mock or live");
        const current = config();
        const next: AppConfig = {
          mode: (input.mode as AppConfig["mode"]) || current.mode,
          model:
            input.model === undefined
              ? current.model
              : str(input.model, "model", 100),
          domain:
            input.domain === undefined
              ? current.domain
              : str(input.domain, "domain", 100),
          diseaseContext:
            input.diseaseContext === undefined
              ? current.diseaseContext
              : str(input.diseaseContext, "diseaseContext", 1000, false),
        };
        if (!/^[a-zA-Z0-9_.:\/-]+$/.test(next.model))
          bad("model must be a provider model identifier");
        saveConfig(next);
        audit("configuration_updated", null, `mode=${next.mode}`);
        return json(safeConfig());
      }
    }
    if (path === "/api/reports" && method === "GET")
      return json({
        reports: all<Report>("reports")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => ({
            id: r.id,
            filename: r.filename,
            mime: r.mime,
            size: r.size,
            status: r.status,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            source: r.source,
            candidateCount: r.candidateCount,
            warningCount: r.warningCount,
            job: r.job,
          })),
      });
    if (path === "/api/reports" && method === "POST") {
      assertCapacity();
      const contentType = req.headers.get("content-type") || "";
      if (!contentType.includes("multipart/form-data"))
        throw new AppError(
          415,
          "MULTIPART_REQUIRED",
          "Use multipart/form-data with one file field",
        );
      const length = Number(req.headers.get("content-length") || 0);
      if (length > LIMITS.maxFileBytes + 1024 * 1024)
        throw new AppError(
          413,
          "FILE_TOO_LARGE",
          "Upload exceeds configured size limit",
        );
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        bad("Invalid multipart upload");
      }
      const items = form.getAll("file");
      if (items.length !== 1 || !(items[0] instanceof File))
        bad("Upload exactly one file");
      for (const key of form.keys())
        if (!["file", "mode", "previewId", "consent"].includes(key))
          bad("Unexpected multipart field");
      const file = items[0];
      if (file.size > LIMITS.maxFileBytes)
        throw new AppError(
          413,
          "FILE_TOO_LARGE",
          "Upload exceeds configured size limit",
        );
      const bytes = new Uint8Array(await file.arrayBuffer()),
        verified = verifyUpload(file.name, bytes),
        id = crypto.randomUUID(),
        storedPath = join(FILE_DIR, `${id}.${verified.extension}`),
        now = new Date().toISOString();
      const mode = form.get("mode") || DEFAULT_PARSING_MODE;
      if (mode !== "local" && mode !== "glm") bad("Invalid parsing mode");
      if (mode === "glm") {
        validateCloudFile(bytes, verified.extension);
        consumeFileConsent(form, bytes, file, cookieId || "bearer");
      } else if (form.has("previewId") || form.has("consent"))
        bad("Cloud consent cannot be used in local mode");
      await Bun.write(storedPath, bytes);
      await chmod(storedPath, 0o600);
      const report: Report = {
        id,
        filename: file.name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 180),
        mime: verified.mime,
        size: file.size,
        status: "processing",
        createdAt: now,
        updatedAt: now,
        source: "upload",
        text: "",
        anchors: [],
        candidates: [],
        annotations: [],
        warnings: [],
        analysis: null,
        candidateCount: 0,
        warningCount: 0,
        history: [],
        storedPath,
      };
      try {
        enqueue(
          report,
          storedPath,
          verified.extension,
          mode as "local" | "glm",
        );
      } catch (error) {
        await unlink(storedPath).catch(() => {});
        throw error;
      }
      audit(
        "report_uploaded",
        id,
        `type=${verified.extension}; bytes=${file.size}`,
      );
      return json(detail(id), 202);
    }
    if (path === "/api/demo" && method === "POST")
      return json(createDemo(), 201);
    if (
      segments[0] === "api" &&
      segments[1] === "jobs" &&
      segments.length === 3 &&
      method === "GET"
    ) {
      const job = findJob(segments[2]);
      if (!job) throw new AppError(404, "JOB_NOT_FOUND", "Job not found");
      return json(job);
    }
    if (segments[0] === "api" && segments[1] === "reports" && segments[2]) {
      const id = segments[2],
        action = segments[3];
      if (segments.length === 3 && method === "GET")
        return json(
          detail(id) ||
            (() => {
              throw new AppError(404, "REPORT_NOT_FOUND", "Report not found");
            })(),
        );
      if (action === "original" && method === "GET") {
        const report = requireReport(id);
        if (!report.storedPath)
          throw new AppError(
            404,
            "NO_ORIGINAL",
            "Synthetic report has no uploaded original",
          );
        return new Response(Bun.file(report.storedPath), {
          headers: {
            "Content-Type": report.mime,
            "Content-Disposition": `attachment; filename="report-${report.id}${extname(report.storedPath)}"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (action === "export" && method === "GET")
        return exportReport(
          detail(id) || requireReport(id),
          url.searchParams.get("format") || "json",
        );
      if (action === "annotations" && method === "POST") {
        const report = mutableReport(id),
          input = await body(req);
        keys(input, [
          "anchorId",
          "label",
          "value",
          "unit",
          "referenceLow",
          "referenceHigh",
          "note",
        ]);
        const anchorId = str(input.anchorId, "anchorId");
        if (!report.anchors.some((a) => a.id === anchorId))
          bad("anchorId must belong to the report", "INVALID_ANCHOR");
        const value = input.value;
        if (
          !(typeof value === "number" && Number.isFinite(value)) &&
          !(typeof value === "string" && value.trim() && value.length < 100)
        )
          bad("value must be a finite number or short nonempty string");
        const low = finite(input.referenceLow, "referenceLow"),
          high = finite(input.referenceHigh, "referenceHigh");
        if (low !== undefined && high !== undefined && low > high)
          bad("referenceLow cannot exceed referenceHigh");
        const annotation: Annotation = {
          id: crypto.randomUUID(),
          anchorId,
          label: str(input.label, "label", 80),
          value: value as number | string,
          unit: str(input.unit, "unit", 40, false),
          referenceLow: low,
          referenceHigh: high,
          note: str(input.note, "note", 1000, false),
          createdAt: new Date().toISOString(),
        };
        report.annotations = report.annotations.filter(
          (a) =>
            !(
              a.anchorId === annotation.anchorId &&
              normalize(a.label) === normalize(annotation.label)
            ),
        );
        report.annotations.push(annotation);
        report.analysis = null;
        evaluate(report);
        audit("annotation_added", id, "source_anchor_preserved");
        return json(saveReport(report), 201);
      }
      if (action === "annotations" && segments[4] && method === "DELETE") {
        const report = mutableReport(id);
        const found = report.annotations.find((x) => x.id === segments[4]);
        if (!found)
          throw new AppError(
            404,
            "ANNOTATION_NOT_FOUND",
            "Annotation not found",
          );
        report.annotations = report.annotations.filter(
          (x) => x.id !== segments[4],
        );
        const template = report.templateId
          ? get<Template>("templates", report.templateId)
          : null;
        report.candidates = extractCandidates(
          report.anchors,
          template ? [...template.fields, ...CATALOG] : CATALOG,
        );
        report.analysis = null;
        evaluate(report);
        audit("annotation_removed", id);
        return json(saveReport(report));
      }
      if (action === "apply-template" && method === "POST") {
        const report = mutableReport(id),
          input = await body(req);
        keys(input, ["templateId"]);
        const template = get<Template>(
          "templates",
          str(input.templateId, "templateId"),
        );
        if (!template)
          throw new AppError(404, "TEMPLATE_NOT_FOUND", "Template not found");
        report.templateId = template.id;
        report.candidates = extractCandidates(report.anchors, [
          ...template.fields,
          ...CATALOG,
        ]);
        report.analysis = null;
        evaluate(report);
        audit("template_applied", id, `fields=${template.fields.length}`);
        return json(saveReport(report));
      }
      if (action === "evaluate" && method === "POST") {
        const report = mutableReport(id);
        report.analysis = null;
        evaluate(report);
        audit("rules_evaluated", id);
        return json(saveReport(report));
      }
      if (action === "ai-preview" && method === "POST") {
        const report = mutableReport(id),
          input = await body(req);
        keys(input, ["anchorIds"]);
        return json(createPreview(report, config(), input.anchorIds));
      }
      if (action === "analyze" && method === "POST") {
        if (inflightAnalysis.has(id))
          throw new AppError(
            409,
            "ANALYSIS_IN_PROGRESS",
            "Analysis is already running for this report",
          );
        const report = mutableReport(id),
          input = await body(req);
        keys(input, ["previewId", "consent", "anchorIds"]);
        inflightAnalysis.add(id);
        try {
          const analysis = await analyze(report, config(), input);
          const current = requireReport(id);
          if (current.updatedAt !== report.updatedAt)
            throw new AppError(
              409,
              "REPORT_CHANGED",
              "Report changed during analysis; result was not attached. The consented excerpts may already have been transmitted.",
            );
          current.analysis = analysis;
          return json(saveReport(current));
        } finally {
          inflightAnalysis.delete(id);
        }
      }
    }
    if (segments[0] === "api" && segments[1] === "templates") {
      const id = segments[2];
      if (!id && method === "GET") return json({ templates: templates() });
      if ((!id && method === "POST") || (id && method === "PUT")) {
        const input = await body(req);
        keys(input, ["name", "domain", "fields"]);
        const existing = id ? get<Template>("templates", id) : null;
        if (id && !existing)
          throw new AppError(404, "TEMPLATE_NOT_FOUND", "Template not found");
        const now = new Date().toISOString();
        const template: Template = {
          id: id || crypto.randomUUID(),
          name: str(input.name, "name"),
          domain: str(input.domain, "domain", 100, false),
          fields: parseFields(input.fields),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        put("templates", template.id, template);
        audit("template_saved", null, `fields=${template.fields.length}`);
        return json(template, id ? 200 : 201);
      }
      if (id && method === "DELETE") {
        if (!get("templates", id))
          throw new AppError(404, "TEMPLATE_NOT_FOUND", "Template not found");
        remove("templates", id);
        audit("template_deleted");
        return json({ ok: true });
      }
    }
    if (segments[0] === "api" && segments[1] === "rules") {
      const id = segments[2];
      if (!id && method === "GET") return json({ rules: rules() });
      if ((!id && method === "POST") || (id && method === "PUT")) {
        const existing = id ? get<Rule>("rules", id) : null;
        if (id && !existing)
          throw new AppError(404, "RULE_NOT_FOUND", "Rule not found");
        const rule = parseRule(await body(req), existing || undefined);
        put("rules", rule.id, rule);
        audit("rule_saved", null, `kind=${rule.kind}`);
        return json(rule, id ? 200 : 201);
      }
      if (id && method === "DELETE") {
        if (!get("rules", id))
          throw new AppError(404, "RULE_NOT_FOUND", "Rule not found");
        remove("rules", id);
        audit("rule_deleted");
        return json({ ok: true });
      }
    }
    if (path === "/api/history" && method === "GET")
      return json({ history: history() });
    if (path === "/api/openapi.json" && method === "GET") return json(openapi);
    if (path === "/api/docs" && method === "GET")
      return new Response(
        '<!doctype html><html><meta charset="utf-8"><title>医疗报告分析 API</title><link rel="stylesheet" href="/api/docs-assets/swagger-ui.css"><div id="swagger-ui"></div><script src="/api/docs-assets/swagger-ui-bundle.js"></script><script src="/api/docs-assets/init.js"></script></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } },
      );
    if (path === "/api/docs-assets/init.js" && method === "GET")
      return new Response(
        'window.onload=()=>SwaggerUIBundle({url:"/api/openapi.json",dom_id:"#swagger-ui",persistAuthorization:false});',
        { headers: { "Content-Type": "application/javascript" } },
      );
    if (path.startsWith("/api/docs-assets/") && method === "GET") {
      const asset = segments[2];
      if (!["swagger-ui.css", "swagger-ui-bundle.js"].includes(asset))
        throw new AppError(404, "NOT_FOUND", "Asset not found");
      return new Response(
        Bun.file(join(ROOT, "node_modules", "swagger-ui-dist", asset)),
      );
    }
    if (path.startsWith("/api/"))
      throw new AppError(404, "NOT_FOUND", "API route not found");
    const staticPath = resolve(ROOT, "dist", "." + decodeURIComponent(path));
    if (
      !staticPath.startsWith(resolve(ROOT, "dist") + "/") &&
      staticPath !== resolve(ROOT, "dist")
    )
      throw new AppError(403, "INVALID_PATH", "Invalid path");
    const staticFile = Bun.file(staticPath);
    if (await staticFile.exists()) return new Response(staticFile);
    const index = Bun.file(join(ROOT, "dist", "index.html"));
    if (await index.exists()) return new Response(index);
    return new Response(
      "医疗报告分析 API is running. Start the Vite frontend on port 5173, or build the frontend to serve it here.",
      { headers: { "Content-Type": "text/plain" } },
    );
  } catch (error) {
    if (error instanceof AppError)
      return json({ error: error.message, code: error.code }, error.status);
    audit("request_failed", null, "INTERNAL_ERROR");
    return json(
      {
        error: "The request could not be completed safely",
        code: "INTERNAL_ERROR",
      },
      500,
    );
  }
}
recoverInterruptedJobs();
seed();
export const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  maxRequestBodySize: LIMITS.maxFileBytes + 1024 * 1024,
  idleTimeout: 60,
  fetch: async (req) => {
    const response = await handle(req);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Frame-Options", "DENY");
    return response;
  },
});
console.log(
  `医疗报告分析 local server listening on http://${HOST}:${server.port} (${config().mode} mode; no credentials logged)`,
);
process.on("SIGINT", () => {
  stopExtractionProcesses();
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopExtractionProcesses();
  server.stop();
  process.exit(0);
});
