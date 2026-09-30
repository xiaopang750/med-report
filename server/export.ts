import type { Report } from "./types";
const html = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[\s\uFEFF]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportReport(report: Report, format: string): Response {
  const name = `report-${report.id}`;
  if (format === "json")
    return new Response(JSON.stringify(report, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.json"`,
      },
    });
  if (format === "csv") {
    const rows = [
      [
        "Field",
        "Value",
        "Unit",
        "Reference",
        "Status",
        "Confidence",
        "Evidence",
        "Reason",
      ],
      ...report.candidates.map((c) => [
        c.label,
        c.value,
        c.unit,
        c.referenceRange?.text,
        c.status,
        c.confidence,
        c.anchorIds.join("; "),
        c.reason,
      ]),
    ];
    return new Response(
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.csv"`,
        },
      },
    );
  }
  if (format === "html") {
    const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>报告复核导出</title><style>body{font:14px/1.7 system-ui,sans-serif;color:#172c2a;max-width:1100px;margin:40px auto;padding:0 24px}h1{font-size:27px}small{color:#50645f}.notice{border:1px solid #c5b66d;background:#fffae7;padding:16px}table{width:100%;border-collapse:collapse;margin:24px 0}th,td{border:1px solid #d5ded9;text-align:left;padding:8px;vertical-align:top}pre{white-space:pre-wrap;word-break:break-word}a{color:inherit}tr{break-inside:avoid}@media print{body{margin:0;padding:0}a{text-decoration:none}}</style><h1>检验报告 · 人工复核记录</h1><p>${html(report.filename)}<br><small>记录 ${html(report.id)} · ${html(report.updatedAt)} · ${report.source === "demo" ? "合成演示数据" : "用户上传"}</small></p><div class="notice">仅供信息整理与人工复核，不构成诊断或治疗建议。OCR、字段提取、规则和模型均可能出错。异常不等于患病，正常也不能排除疾病。${report.source === "demo" ? "本报告全部数据为虚构。" : ""}</div><h2>注意事项</h2><ul>${report.warnings.map((w) => `<li>${html(w)}</li>`).join("")}</ul><h2>结构化字段</h2><table><thead><tr>${["字段", "结果", "单位", "参考范围", "状态", "置信度", "原文定位", "解释"].map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${report.candidates.map((c) => `<tr><td>${html(c.label)}</td><td>${html(c.value)}</td><td>${html(c.unit)}</td><td>${html(c.referenceRange?.text || "未提供")}</td><td>${html(c.status)}</td><td>${html(c.confidence)}</td><td>${c.anchorIds.map((id) => `<a href="#${html(id)}">${html(id)}</a>`).join(", ")}</td><td>${html(c.reason)}</td></tr>`).join("")}</tbody></table>${report.analysis ? `<h2>AI 信息整理 · ${html(report.analysis.mode)}</h2><p>${html(report.analysis.summary)}</p><ul>${report.analysis.findings.map((f) => `<li>${html(f.text)} [${f.anchorIds.map(html).join(", ")}]</li>`).join("")}</ul><ul>${report.analysis.limitations.map((x) => `<li>${html(x)}</li>`).join("")}</ul>` : ""}<h2>原文证据</h2>${report.anchors.map((a) => `<p id="${html(a.id)}"><small>${html(a.id)} · ${html(a.method)}</small><br>${html(a.text)}</p>`).join("")}<p><small>可使用浏览器的打印功能保存 PDF。本导出包含报告文本，请谨慎保管。</small></p></html>`;
    return new Response(page, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${name}.html"`,
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      },
    });
  }
  return new Response(
    JSON.stringify({
      error: "Supported formats: json, csv, html",
      code: "INVALID_FORMAT",
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}
