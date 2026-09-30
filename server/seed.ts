import { all, put, saveReport, audit } from "./db";
import { CATALOG, extractCandidates, evaluateCandidates } from "./evaluate";
import type { Anchor, Report, Rule, Template } from "./types";
import { config, rules } from "./db";
export function createDemo(): Report {
  const now = new Date().toISOString();
  const lines = [
    "合成演示报告 · 不含真实个人信息",
    "项目 | 结果 | 单位 | 参考范围",
    "空腹血糖 7.2 mmol/L 3.9-6.1",
    "糖化血红蛋白 6.4 % 4.0-6.0",
    "血红蛋白 138 g/L 115-150",
    "白细胞 6.1 10^9/L 3.5-9.5",
    "C反应蛋白 12.6 mg/L 0-8",
    "尿蛋白 阴性",
    "肌酐 79 μmol/L 44-97",
    "总胆固醇 5.8 mmol/L",
    "未知标记 7 widgets 1-5",
    "以上为虚构数据，仅用于演示。结果需要人工核对，不用于诊断。",
  ];
  const anchors: Anchor[] = lines.map((text, i) => ({
    id: `p1-l${i + 1}`,
    page: 1,
    line: i + 1,
    text,
    method: "text",
  }));
  const report: Report = {
    id: crypto.randomUUID(),
    filename: "合成示例_检验报告.txt",
    mime: "text/plain",
    size: Buffer.byteLength(lines.join("\n")),
    status: "needs_review",
    createdAt: now,
    updatedAt: now,
    source: "demo",
    text: lines.join("\n"),
    anchors,
    candidates: evaluateCandidates(
      extractCandidates(anchors),
      rules(),
      config().domain,
      anchors,
    ),
    annotations: [],
    warnings: [
      "合成演示数据，不代表任何真实患者。",
      "参考范围受实验室、检测方法和个人情况影响；缺少范围或单位的结果保持不确定。",
    ],
    analysis: null,
    candidateCount: 0,
    warningCount: 0,
    history: [],
  };
  audit("demo_created", report.id, "synthetic_only");
  return saveReport(report);
}
export function seed() {
  if (!all<Template>("templates").length) {
    const now = new Date().toISOString();
    put("templates", "template-basic-lab", {
      id: "template-basic-lab",
      name: "基础检验字段（示例）",
      domain: "检验报告",
      fields: CATALOG,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!all<Rule>("rules").length) {
    const now = new Date().toISOString();
    put("rules", "rule-urine-protein", {
      id: "rule-urine-protein",
      name: "尿蛋白定性（示例）",
      label: "尿蛋白",
      aliases: ["Protein", "Urine protein"],
      kind: "qualitative",
      unit: "",
      normalValues: ["阴性", "negative"],
      abnormalValues: ["阳性", "positive", "弱阳性", "+", "++", "+++"],
      enabled: true,
      domain: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!all<Report>("reports").length) createDemo();
}
