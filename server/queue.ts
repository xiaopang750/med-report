import { extractCloud } from "./file-parser";
import { all, get, saveReport, audit, config, rules, templates } from "./db";
import { extract, LIMITS } from "./extract";
import {
  CATALOG,
  extractCandidates,
  mergeAnnotations,
  evaluateCandidates,
} from "./evaluate";
import type { Job, Report } from "./types";
import { AppError } from "./errors";
type Work = {
  reportId: string;
  path: string;
  extension: string;
  mode: "local" | "glm";
};
const waiting: Work[] = [];
let active = 0;
export function queueState() {
  return {
    active,
    queued: waiting.length,
    concurrency: LIMITS.concurrency,
    maxQueue: LIMITS.maxQueue,
  };
}
export function assertCapacity() {
  if (waiting.length >= LIMITS.maxQueue)
    throw new AppError(
      429,
      "QUEUE_FULL",
      "The local extraction queue is full. Wait for current work to finish and retry.",
    );
}
export function evaluate(report: Report): Report {
  report.candidates = evaluateCandidates(
    mergeAnnotations(
      report.candidates.filter((c) => c.source === "extracted"),
      report.annotations,
    ),
    rules(),
    config().domain,
    report.anchors,
  );
  if (report.status !== "error" && report.status !== "processing")
    report.status =
      report.warnings.length ||
      report.candidates.some((c) => c.status === "uncertain")
        ? "needs_review"
        : "ready";
  return report;
}
export function enqueue(
  report: Report,
  path: string,
  extension: string,
  mode: "local" | "glm" = "local",
) {
  assertCapacity();
  report.job = {
    id: crypto.randomUUID(),
    reportId: report.id,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
  report.status = "processing";
  saveReport(report);
  waiting.push({ reportId: report.id, path, extension, mode });
  queueMicrotask(pump);
}
function pump() {
  while (active < LIMITS.concurrency && waiting.length) {
    const work = waiting.shift()!;
    active++;
    void run(work).finally(() => {
      active--;
      pump();
    });
  }
}
async function run(work: Work) {
  let report = get<Report>("reports", work.reportId);
  if (!report) return;
  report.job = {
    ...report.job!,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  saveReport(report);
  try {
    const result =
      work.mode === "glm"
        ? await extractCloud(
            new Uint8Array(await Bun.file(work.path).arrayBuffer()),
            work.extension,
            report.mime,
          )
        : await extract(work.path, work.extension);
    report = get<Report>("reports", work.reportId)!;
    report.text = result.text;
    report.anchors = result.anchors;
    report.warnings = result.warnings;
    report.candidates = extractCandidates(report.anchors);
    report.status = report.anchors.length ? "ready" : "needs_review";
    evaluate(report);
    if (!report.candidates.length)
      report.warnings.push(
        "No reliable measurement candidates were identified; do not interpret this as a normal report.",
      );
    report.status =
      report.warnings.length ||
      report.candidates.some((c) => c.status === "uncertain")
        ? "needs_review"
        : "ready";
    report.job = {
      ...report.job!,
      status: "complete",
      finishedAt: new Date().toISOString(),
    };
    audit(
      "extraction_completed",
      report.id,
      `anchors=${report.anchors.length}; candidates=${report.candidates.length}; warnings=${report.warnings.length}`,
    );
  } catch (error) {
    report = get<Report>("reports", work.reportId)!;
    const message =
      error instanceof AppError
        ? error.message
        : "Local extraction failed safely. Review the original or upload a simpler document.";
    report.status = "error";
    report.warnings = [message];
    report.job = {
      ...report.job!,
      status: "error",
      finishedAt: new Date().toISOString(),
      error: message,
    };
    audit(
      "extraction_failed",
      report.id,
      error instanceof AppError ? error.code : "EXTRACTION_FAILED",
    );
  }
  saveReport(report);
}
export function recoverInterruptedJobs() {
  for (const report of all<Report>("reports"))
    if (report.status === "processing") {
      report.status = "error";
      report.warnings.push(
        "Server restarted during extraction. Upload the file again to retry.",
      );
      if (report.job)
        report.job = {
          ...report.job,
          status: "error",
          finishedAt: new Date().toISOString(),
          error: "Interrupted by server restart",
        };
      saveReport(report);
      audit("extraction_interrupted", report.id);
    }
}
export function findJob(id: string): Job | null {
  return all<Report>("reports").find((r) => r.job?.id === id)?.job || null;
}
