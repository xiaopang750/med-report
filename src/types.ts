export type Page = "workspace" | "history" | "templates" | "rules" | "settings";
export type Anchor = {
  id: string;
  page: number;
  line: number;
  text: string;
  method: string;
};
export type Candidate = {
  id: string;
  label: string;
  value: number | string | null;
  unit: string;
  referenceRange: { low?: number; high?: number; text: string } | null;
  anchorIds: string[];
  confidence: string;
  status: string;
  reason: string;
  source: string;
  ruleId?: string;
};
export type Annotation = {
  id: string;
  anchorId: string;
  label: string;
  value: number | string;
  unit: string;
  referenceLow?: number;
  referenceHigh?: number;
  note: string;
  createdAt: string;
};
export type Analysis = {
  id: string;
  mode: string;
  model: string;
  createdAt: string;
  summary: string;
  findings: { text: string; anchorIds: string[] }[];
  limitations: string[];
  selectedAnchorIds: string[];
  domain: string;
  diseaseContext: string;
};
export type Report = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  source: string;
  candidateCount?: number;
  warningCount?: number;
  text?: string;
  anchors?: Anchor[];
  candidates?: Candidate[];
  annotations?: Annotation[];
  warnings?: string[];
  analysis?: Analysis | null;
  history?: any[];
  job?: {
    id: string;
    status: string;
    progress?: number;
    message?: string;
    error?: string;
  };
};
export type Template = {
  id: string;
  name: string;
  domain: string;
  fields: { label: string; aliases: string[]; unit?: string }[];
  createdAt?: string;
  updatedAt?: string;
};
export type Rule = {
  id: string;
  name: string;
  label: string;
  aliases?: string[];
  kind: "numeric" | "qualitative" | "range";
  unit?: string;
  low?: number;
  high?: number;
  normalValues?: string[];
  abnormalValues?: string[];
  enabled?: boolean;
  domain?: string;
};
export type Config = {
  mode: "mock" | "live";
  model: string;
  endpoint: string;
  keyConfigured: boolean;
  domain: string;
  diseaseContext: string;
  privacyWarning?: string;
};
export type Preview = {
  previewId: string;
  expiresAt: string;
  excerpts: { anchorId: string; text: string }[];
  warnings: string[];
  mode: string;
  model: string;
  endpoint: string;
  payload?: unknown;
};
export type Health = {
  ok: boolean;
  version: string;
  mode: string;
  capabilities?: {
    pdftotext: boolean;
    pdftoppm: boolean;
    tesseract: boolean;
    antiword: boolean;
    ocrLanguages?: string[];
  };
  limits?: Record<string, unknown>;
};
