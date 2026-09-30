import { Database } from "bun:sqlite";
import { mkdirSync, appendFileSync, chmodSync } from "node:fs";
import { resolve, join } from "node:path";
import type {
  AppConfig,
  History,
  Preview,
  Report,
  Rule,
  Template,
} from "./types";
export const ROOT = resolve(import.meta.dir, "..");
export const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, "data"));
export const FILE_DIR = resolve(process.env.FILE_DIR || join(ROOT, "file"));
export const LOG_DIR = resolve(process.env.LOG_DIR || join(ROOT, "logs"));
for (const dir of [DATA_DIR, FILE_DIR, LOG_DIR])
  mkdirSync(dir, { recursive: true, mode: 0o700 });
export const db = new Database(join(DATA_DIR, "reports.sqlite"), {
  create: true,
});
try {
  chmodSync(join(DATA_DIR, "reports.sqlite"), 0o600);
} catch {}
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, report_id TEXT, action TEXT NOT NULL, created_at TEXT NOT NULL, detail TEXT NOT NULL);`);
type Table = "reports" | "templates" | "rules" | "settings" | "previews";
export function get<T>(table: Table, id: string): T | null {
  const row = db.query(`SELECT body FROM ${table} WHERE id=?`).get(id) as {
    body: string;
  } | null;
  return row ? (JSON.parse(row.body) as T) : null;
}
export function all<T>(table: Table): T[] {
  return (
    db.query(`SELECT body FROM ${table}`).all() as { body: string }[]
  ).map((row) => JSON.parse(row.body) as T);
}
export function put<T extends { id?: string }>(
  table: Table,
  id: string,
  obj: T,
): void {
  db.query(
    `INSERT INTO ${table}(id,body) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body`,
  ).run(id, JSON.stringify(obj));
}
export function remove(table: Table, id: string): void {
  db.query(`DELETE FROM ${table} WHERE id=?`).run(id);
}
export function history(reportId?: string): History[] {
  const rows = (
    reportId
      ? db
          .query(
            "SELECT * FROM history WHERE report_id=? ORDER BY created_at DESC LIMIT 200",
          )
          .all(reportId)
      : db
          .query("SELECT * FROM history ORDER BY created_at DESC LIMIT 500")
          .all()
  ) as {
    id: string;
    report_id: string | null;
    action: string;
    created_at: string;
    detail: string;
  }[];
  return rows.map((x) => ({
    id: x.id,
    reportId: x.report_id,
    action: x.action,
    createdAt: x.created_at,
    detail: x.detail,
  }));
}
export function audit(
  action: string,
  reportId: string | null = null,
  detail = "",
): void {
  const item = {
    id: crypto.randomUUID(),
    reportId,
    action,
    createdAt: new Date().toISOString(),
    detail,
  };
  db.query("INSERT INTO history VALUES (?,?,?,?,?)").run(
    item.id,
    reportId,
    action,
    item.createdAt,
    detail,
  ); // Callers supply constant metadata only; never filenames, source text, model output, credentials, or error bodies.
  try {
    appendFileSync(
      join(LOG_DIR, "operations.jsonl"),
      JSON.stringify(item) + "\n",
      { mode: 0o600 },
    );
  } catch {}
}
export function config(): AppConfig {
  return (
    get<AppConfig>("settings", "config") || {
      mode: process.env.AI_MODE === "live" ? "live" : "mock",
      model: process.env.GLM_MODEL || "glm-5.3",
      domain: "检验报告",
      diseaseContext: "",
    }
  );
}
export function saveConfig(value: AppConfig): void {
  put("settings", "config", value as AppConfig & { id?: string });
}
export function saveReport(report: Report): Report {
  report.updatedAt = new Date(
    Math.max(Date.now(), Date.parse(report.updatedAt) + 1),
  ).toISOString();
  report.candidateCount = report.candidates.length;
  report.warningCount = report.warnings.length;
  const stored = { ...report, history: [] };
  put("reports", report.id, stored);
  return detail(report.id)!;
}
export function detail(id: string): Report | null {
  const report = get<Report>("reports", id);
  if (!report) return null;
  const { storedPath: _, ...safe } = report;
  return { ...safe, history: history(id) };
}
export function rules(): Rule[] {
  return all<Rule>("rules");
}
export function templates(): Template[] {
  return all<Template>("templates");
}
export function savePreview(preview: Preview): void {
  for (const old of all<Preview>("previews"))
    if (Date.parse(old.expiresAt) < Date.now()) remove("previews", old.id);
  put("previews", preview.id, preview);
}
