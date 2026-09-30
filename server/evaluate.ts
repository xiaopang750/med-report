import type {
  Anchor,
  Annotation,
  Candidate,
  ReferenceRange,
  Rule,
  TemplateField,
} from "./types";
export const CATALOG: TemplateField[] = [
  {
    label: "血糖",
    aliases: ["Glucose", "GLU", "血糖", "葡萄糖"],
    unit: "mmol/L",
  },
  {
    label: "空腹血糖",
    aliases: ["Fasting glucose", "FPG", "空腹血糖", "空腹葡萄糖"],
    unit: "mmol/L",
  },
  {
    label: "糖化血红蛋白",
    aliases: ["HbA1c", "A1C", "糖化血红蛋白"],
    unit: "%",
  },
  {
    label: "血红蛋白",
    aliases: ["Hemoglobin", "HGB", "Hb", "血红蛋白"],
    unit: "g/L",
  },
  {
    label: "白细胞",
    aliases: ["WBC", "White blood cells", "白细胞", "白细胞计数"],
    unit: "10^9/L",
  },
  {
    label: "红细胞",
    aliases: ["RBC", "Red blood cells", "红细胞", "红细胞计数"],
    unit: "10^12/L",
  },
  {
    label: "血小板",
    aliases: ["Platelets", "PLT", "血小板", "血小板计数"],
    unit: "10^9/L",
  },
  {
    label: "C反应蛋白",
    aliases: ["CRP", "C-reactive protein", "C反应蛋白"],
    unit: "mg/L",
  },
  {
    label: "超敏C反应蛋白",
    aliases: ["hs-CRP", "高敏C反应蛋白", "超敏C反应蛋白"],
    unit: "mg/L",
  },
  {
    label: "总胆固醇",
    aliases: ["Total cholesterol", "TC", "CHOL", "总胆固醇"],
    unit: "mmol/L",
  },
  {
    label: "甘油三酯",
    aliases: ["Triglycerides", "TG", "甘油三酯"],
    unit: "mmol/L",
  },
  {
    label: "低密度脂蛋白胆固醇",
    aliases: ["LDL-C", "LDL", "低密度脂蛋白胆固醇"],
    unit: "mmol/L",
  },
  {
    label: "高密度脂蛋白胆固醇",
    aliases: ["HDL-C", "HDL", "高密度脂蛋白胆固醇"],
    unit: "mmol/L",
  },
  {
    label: "丙氨酸氨基转移酶",
    aliases: ["ALT", "丙氨酸氨基转移酶", "谷丙转氨酶"],
    unit: "U/L",
  },
  {
    label: "天门冬氨酸氨基转移酶",
    aliases: ["AST", "天门冬氨酸氨基转移酶", "谷草转氨酶"],
    unit: "U/L",
  },
  {
    label: "肌酐",
    aliases: ["Creatinine", "CREA", "Cr", "肌酐"],
    unit: "μmol/L",
  },
  { label: "尿素", aliases: ["Urea", "尿素"], unit: "mmol/L" },
  { label: "尿素氮", aliases: ["BUN", "血尿素氮", "尿素氮"], unit: "mmol/L" },
  { label: "尿酸", aliases: ["Uric acid", "UA", "尿酸"], unit: "μmol/L" },
  {
    label: "总胆红素",
    aliases: ["Total bilirubin", "TBIL", "总胆红素"],
    unit: "μmol/L",
  },
  { label: "白蛋白", aliases: ["Albumin", "ALB", "白蛋白"], unit: "g/L" },
  { label: "钾", aliases: ["Potassium", "K", "血钾", "钾"], unit: "mmol/L" },
  { label: "钠", aliases: ["Sodium", "Na", "血钠", "钠"], unit: "mmol/L" },
  {
    label: "尿蛋白",
    aliases: ["Urine protein", "Protein", "尿蛋白"],
    unit: "",
  },
  { label: "尿潜血", aliases: ["Occult blood", "尿潜血"], unit: "" },
  { label: "乙肝表面抗原", aliases: ["HBsAg", "乙肝表面抗原"], unit: "" },
  { label: "促甲状腺激素", aliases: ["TSH", "促甲状腺激素"], unit: "mIU/L" },
];
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s()（）_]/g, "")
    .replace(/μ/g, "u")
    .replace(/×/g, "x");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const IDENTITY_LINE =
  /(?:姓名|患者|病人|身份证|证件|电话|手机|住址|地址|病历|住院号|门诊号|就诊号|样本号|报告编号|送检号|申请号|条码|出生|性别|年龄|医师|医生|审核|签名|name\s*[:：]|patient|passport|address|phone|mobile|birth|\b(?:MRN|DOB|SSN|ID)\b|e-?mail)/i;
const UNIT_RE =
  /^(?:%|(?:10\^?[912]|[x×]10\^?[912])\s*\/\s*[lL]|(?:mmol|μmol|umol|mol|mg|μg|ug|ng|pg|g|mIU|IU|U|fL|fl|mL|ml|mEq)\s*(?:\/\s*(?:dL|dl|mL|ml|L|l))?)(?![\p{L}])/u;
export function knownUnit(s: string): boolean {
  return s === "" || (UNIT_RE.test(s) && s.match(UNIT_RE)?.[0] === s);
}
function reference(text: string): ReferenceRange | null {
  const cleaned = text.replace(/[（(]/g, " ").replace(/[）)]/g, " ");
  const range = cleaned.match(
    /(?:参考(?:值|范围|区间)?|ref(?:erence)?(?:\s*range)?|range)?\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*(?:-|–|—|~|～|至)\s*(-?\d+(?:\.\d+)?)/i,
  );
  if (range) {
    const low = Number(range[1]),
      high = Number(range[2]);
    if (low <= high) return { low, high, text: range[0].trim() };
    return { text: range[0].trim() };
  }
  const upper = cleaned.match(
    /(?:参考(?:值|范围|区间)?|ref(?:erence)?|range)?\s*[:：]?\s*(?:≤|<=|<)\s*(\d+(?:\.\d+)?)/i,
  );
  if (upper) return { high: Number(upper[1]), text: upper[0].trim() };
  const lower = cleaned.match(/(?:≥|>=|>)\s*(\d+(?:\.\d+)?)/);
  if (lower) return { low: Number(lower[1]), text: lower[0].trim() };
  return null;
}
export function extractCandidates(
  anchors: Anchor[],
  fields: TemplateField[] = CATALOG,
): Candidate[] {
  const result: Candidate[] = [];
  const names = fields
    .flatMap((f) =>
      [f.label, ...f.aliases].map((alias) => ({ field: f, alias })),
    )
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const anchor of anchors) {
    if (IDENTITY_LINE.test(anchor.text)) continue;
    const line = anchor.text
      .replace(/[|\t]/g, " ")
      .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
      .trim();
    let label = "",
      rest = "",
      matched = false;
    for (const item of names) {
      const match = line.match(
        new RegExp(
          `^${escape(item.alias)}(?=\\s|[:：]|[-+\\d]|阴|阳|negative|positive|$)\\s*[:：]?\\s*`,
          "i",
        ),
      );
      if (match) {
        label = item.field.label;
        rest = line.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      const general = line.match(
        /^([\p{L}][\p{L}\s（）()%-]{1,40}?)\s*[:：]?\s+(?=[<>≤≥+\-]?\d|阴性|阳性|negative|positive)/iu,
      );
      if (!general) continue;
      label = general[1].trim();
      rest = line.slice(general[0].length);
    }
    rest = rest.replace(/^[↑↓HL]\s+/, "");
    const numeric = rest.match(/^(-?\d+(?:\.\d+)?)(?![\d.])/);
    const qualified = rest.match(/^([<>≤≥]\s*-?\d+(?:\.\d+)?)/);
    const qualitative = rest.match(
      /^(阴性|阳性|弱阳性|negative|positive|trace|not detected|detected|未检出|检出|正常|异常|\+{1,4}|-)(?=\s|$|[（(])/i,
    );
    let value: number | string | null = null,
      tail = rest,
      uncertain = false;
    if (qualified) {
      value = qualified[1];
      tail = rest.slice(qualified[0].length).trim();
      uncertain = true;
    } else if (numeric) {
      value = Number(numeric[1]);
      tail = rest.slice(numeric[0].length).trim();
    } else if (qualitative) {
      value = qualitative[1];
      tail = rest.slice(qualitative[0].length).trim();
    } else {
      value = null;
      uncertain = true;
    }
    tail = tail.replace(/^[↑↓*HL]+\s*/, "");
    let unit = "";
    const um = tail.match(UNIT_RE);
    if (um) {
      unit = um[0].trim();
      tail = tail.slice(um[0].length).trim();
    } else if (typeof value === "number") {
      const maybe = tail.match(/^([^\d\s:：<>≤≥()[\]]+)\s*/);
      if (maybe && !/^(参考|ref|range)/i.test(maybe[1])) {
        unit = maybe[1];
        tail = tail.slice(maybe[0].length);
      }
    }
    const range = reference(tail);
    const confidence =
      anchor.method === "ocr" ||
      anchor.method === "model" ||
      !matched ||
      uncertain
        ? "low"
        : range
          ? "high"
          : "medium";
    result.push({
      id: `c-${anchor.id}-${result.length + 1}`,
      label,
      value,
      unit,
      referenceRange: range,
      anchorIds: [anchor.id],
      confidence,
      status: "uncertain",
      reason:
        anchor.method === "ocr"
          ? "OCR candidate requires manual verification"
          : "Missing a verified matching rule or complete reference range",
      source: "extracted",
    });
  }
  return result;
}
export function annotationsToCandidates(
  annotations: Annotation[],
): Candidate[] {
  return annotations.map((a) => ({
    id: `manual-${a.id}`,
    label: a.label,
    value: a.value,
    unit: a.unit,
    referenceRange:
      a.referenceLow !== undefined || a.referenceHigh !== undefined
        ? {
            low: a.referenceLow,
            high: a.referenceHigh,
            text: [a.referenceLow ?? "", a.referenceHigh ?? ""].join("–"),
          }
        : null,
    anchorIds: [a.anchorId],
    confidence: "high",
    status: "uncertain",
    reason: "Manually entered; verify source and units",
    source: "manual",
  }));
}
export function evaluateCandidates(
  candidates: Candidate[],
  rules: Rule[],
  domain: string,
  anchors: Anchor[],
): Candidate[] {
  return candidates.map((input) => {
    const c: Candidate = {
      ...input,
      status: "uncertain",
      reason: "No complete, applicable reference range or configured rule",
    };
    delete c.ruleId;
    const matches = rules.filter(
      (r) =>
        r.enabled &&
        (!r.domain || r.domain === domain) &&
        [r.label, ...r.aliases].some(
          (l) => normalize(l) === normalize(c.label),
        ),
    );
    if (matches.length > 1) {
      c.reason = "Multiple rules match; resolve the ambiguous configuration";
      return c;
    }
    const rule = matches[0];
    if (rule) c.ruleId = rule.id;
    if (
      !rule &&
      c.source !== "manual" &&
      !CATALOG.some((f) =>
        [f.label, ...f.aliases].some(
          (label) => normalize(label) === normalize(c.label),
        ),
      )
    ) {
      c.reason =
        "Unrecognized field; apply an explicit field mapping and rule before interpretation";
      return c;
    }
    if (c.value === null) {
      c.reason = "Value could not be extracted reliably";
      return c;
    }
    if (
      c.source !== "manual" &&
      c.anchorIds.some((id) =>
        ["ocr", "model"].includes(
          anchors.find((a) => a.id === id)?.method || "",
        ),
      )
    ) {
      c.reason =
        "OCR/model candidate: confirm value, decimal point and unit with a manual annotation";
      return c;
    }
    if (!knownUnit(c.unit)) {
      c.reason = "Unsupported or ambiguous unit; manual review required";
      return c;
    }
    if (rule && normalize(c.unit) !== normalize(rule.unit)) {
      c.reason = `Unit mismatch: rule requires ${rule.unit || "no unit"}; no automatic conversion`;
      return c;
    }
    if (rule?.kind === "qualitative") {
      if (
        rule.normalValues.some((v) =>
          rule.abnormalValues.some((a) => normalize(a) === normalize(v)),
        )
      ) {
        c.reason =
          "Qualitative rule has conflicting normal and abnormal values";
        return c;
      }
      if (typeof c.value !== "string") {
        c.reason = "Qualitative rule cannot evaluate a numeric value";
        return c;
      }
      if (
        rule.normalValues.some(
          (v) => normalize(v) === normalize(String(c.value)),
        )
      ) {
        c.status = "normal";
        c.reason = "Matches a configured normal qualitative value";
      } else if (
        rule.abnormalValues.some(
          (v) => normalize(v) === normalize(String(c.value)),
        )
      ) {
        c.status = "abnormal";
        c.reason = "Matches a configured abnormal qualitative value";
      } else
        c.reason = "Qualitative value is not covered by the configured rule";
      return c;
    }
    if (typeof c.value !== "number") {
      c.reason =
        "Qualitative or inequality result has no applicable exact-value rule";
      return c;
    }
    if (!c.unit) {
      c.reason = "Missing measurement unit; numeric comparison withheld";
      return c;
    }
    const range = rule ? { low: rule.low, high: rule.high } : c.referenceRange;
    if (!range || (range.low === undefined && range.high === undefined)) {
      c.reason = "Reference range is missing or incomplete";
      return c;
    }
    if (
      range.low !== undefined &&
      range.high !== undefined &&
      range.low > range.high
    ) {
      c.reason = "Reference range is inconsistent";
      return c;
    }
    // Strict inequality limits cannot be represented as inclusive intervals without losing boundary meaning.
    if (
      !rule &&
      c.referenceRange &&
      /[<>](?!=)|[＜＞]/.test(c.referenceRange.text)
    ) {
      c.reason =
        "Strict inequality reference limit requires manual interpretation";
      return c;
    }
    if (range.low !== undefined && c.value < range.low) c.status = "low";
    else if (range.high !== undefined && c.value > range.high)
      c.status = "high";
    else c.status = "normal";
    c.reason = rule
      ? "Compared with the configured rule; this is not a diagnosis"
      : "Compared only with the explicit reference range on the source line";
    return c;
  });
}
export function mergeAnnotations(
  extracted: Candidate[],
  annotations: Annotation[],
): Candidate[] {
  const manual = annotationsToCandidates(annotations);
  return [
    ...extracted.filter(
      (c) =>
        !manual.some(
          (m) =>
            normalize(m.label) === normalize(c.label) &&
            m.anchorIds[0] === c.anchorIds[0],
        ),
    ),
    ...manual,
  ];
}
