export type Status = "normal" | "high" | "low" | "abnormal" | "uncertain";
export interface Anchor {
  id: string;
  page: number | null;
  line: number;
  text: string;
  method: "text" | "ocr" | "docx" | "doc" | "manual" | "model";
}
export interface ReferenceRange {
  low?: number;
  high?: number;
  text: string;
}
export interface Candidate {
  id: string;
  label: string;
  value: number | string | null;
  unit: string;
  referenceRange: ReferenceRange | null;
  anchorIds: string[];
  confidence: "high" | "medium" | "low";
  status: Status;
  reason: string;
  source: "extracted" | "manual";
  ruleId?: string;
}
export interface Annotation {
  id: string;
  anchorId: string;
  label: string;
  value: number | string;
  unit: string;
  referenceLow?: number;
  referenceHigh?: number;
  note: string;
  createdAt: string;
}
export interface Rule {
  id: string;
  name: string;
  label: string;
  aliases: string[];
  kind: "numeric" | "qualitative" | "range";
  unit: string;
  low?: number;
  high?: number;
  normalValues: string[];
  abnormalValues: string[];
  enabled: boolean;
  domain: string;
  createdAt: string;
  updatedAt: string;
}
export interface TemplateField {
  label: string;
  aliases: string[];
  unit?: string;
}
export interface Template {
  id: string;
  name: string;
  domain: string;
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}
export interface Analysis {
  id: string;
  mode: "mock" | "live";
  model: string;
  createdAt: string;
  summary: string;
  findings: { text: string; anchorIds: string[] }[];
  limitations: string[];
  selectedAnchorIds: string[];
  domain: string;
  diseaseContext: string;
}
export interface History {
  id: string;
  reportId: string | null;
  action: string;
  createdAt: string;
  detail: string;
}
export interface Report {
  id: string;
  filename: string;
  mime: string;
  size: number;
  status: "processing" | "ready" | "needs_review" | "error";
  createdAt: string;
  updatedAt: string;
  source: "upload" | "demo";
  text: string;
  anchors: Anchor[];
  candidates: Candidate[];
  annotations: Annotation[];
  warnings: string[];
  analysis: Analysis | null;
  candidateCount: number;
  warningCount: number;
  history: History[];
  storedPath?: string;
  job?: Job;
  templateId?: string;
}
export interface AppConfig {
  mode: "mock" | "live";
  model: string;
  domain: string;
  diseaseContext: string;
}
export interface Preview {
  id: string;
  reportId: string;
  anchorIds: string[];
  excerpts: { anchorId: string; text: string }[];
  expiresAt: string;
  mode: "mock" | "live";
  model: string;
  domain: string;
  diseaseContext: string;
  reportUpdatedAt: string;
}

export interface Job {
  id: string;
  reportId: string;
  status: "queued" | "running" | "complete" | "error";
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}
