const string = { type: "string" },
  number = { type: "number" },
  boolean = { type: "boolean" };
const json = (schema: unknown) => ({ "application/json": { schema } });
const response = (schema: unknown, description = "Success") => ({
  description,
  content: json(schema),
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: unknown) => ({ type: "array", items });
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const parameter = (name: string) => ({
  name,
  in: "path",
  required: true,
  schema: string,
});
const error = {
  description:
    "Invalid request, authentication, consent, unavailable local tools/provider, or stale preview",
  content: json(object({ error: string, code: string }, ["error", "code"])),
};
const responses = (schema: unknown, success = "200") => ({
  [success]: response(schema),
  "400": error,
  "401": error,
  "403": error,
  "404": error,
  "409": error,
  "422": error,
  "500": error,
});
const templateInput = object(
  { name: string, domain: string, fields: array(ref("TemplateField")) },
  ["name", "fields"],
);
const ruleInput = object(
  {
    name: string,
    label: string,
    aliases: array(string),
    kind: { enum: ["numeric", "qualitative", "range"] },
    unit: string,
    low: number,
    high: number,
    normalValues: array(string),
    abnormalValues: array(string),
    enabled: boolean,
    domain: string,
  },
  ["name", "label", "kind"],
);
const annotationInput = object(
  {
    anchorId: string,
    label: string,
    value: { oneOf: [number, string] },
    unit: string,
    referenceLow: number,
    referenceHigh: number,
    note: string,
  },
  ["anchorId", "label", "value"],
);
const reportRoutes: Record<string, unknown> = {};
for (const [route, summary, input] of [
  ["annotations", "Add or update a manually verified field", annotationInput],
  [
    "apply-template",
    "Apply reusable field aliases",
    object({ templateId: string }, ["templateId"]),
  ],
  ["evaluate", "Evaluate configured rules", undefined],
  [
    "ai-preview",
    "Preview the exact minimized AI request",
    object({ anchorIds: array(string) }, ["anchorIds"]),
  ],
  [
    "analyze",
    "Analyze only consented preview evidence",
    object(
      {
        previewId: string,
        consent: { type: "boolean", enum: [true] },
        anchorIds: array(string),
      },
      ["previewId", "consent", "anchorIds"],
    ),
  ],
] as const) {
  reportRoutes[`/api/reports/{id}/${route}`] = {
    post: {
      summary,
      parameters: [parameter("id")],
      ...(input ? { requestBody: body(input) } : {}),
      responses: responses(
        route === "ai-preview" ? ref("Preview") : ref("Report"),
        route === "annotations" ? "201" : "200",
      ),
    },
  };
}
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Local Report Review Studio",
    version: "1.0.0",
    description:
      "Local extraction and evidence-linked review. Synthetic demonstration, not a medical device. AI mock is default. Live endpoint fixed to BigModel Coding Plan; GLM_API_KEY server environment only. Every AI request requires one-use preview, exact anchor IDs and informed consent. Upload processing uses a bounded background queue.",
  },
  servers: [{ url: "/" }],
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],
  paths: {
    "/api/auth/session": {
      get: {
        summary: "Current demo browser session",
        security: [],
        responses: responses(
          object({
            authenticated: boolean,
            username: { type: "string", nullable: true },
            demo: boolean,
          }),
        ),
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Local demo login (admin/admin); sets HttpOnly session cookie",
        security: [],
        requestBody: body(
          object({ username: string, password: string }, [
            "username",
            "password",
          ]),
        ),
        responses: responses(
          object({ authenticated: boolean, username: string, demo: boolean }),
        ),
      },
    },
    "/api/auth/logout": {
      post: {
        summary: "Revoke current demo session and expire its cookie",
        security: [],
        responses: responses(object({ ok: boolean })),
      },
    },
    "/api/health": {
      get: {
        summary: "Health, local tool capabilities and queue budget",
        security: [],
        responses: responses(
          object({
            ok: boolean,
            version: string,
            mode: string,
            capabilities: { type: "object" },
            limits: { type: "object" },
            queue: { type: "object" },
          }),
        ),
      },
    },
    "/api/config": {
      get: {
        summary: "Read safe configuration (never API key)",
        responses: responses(ref("Config")),
      },
      put: {
        summary:
          "Update model, mode and local clinical context; endpoint/key cannot be changed via API",
        requestBody: body(
          object({
            mode: { enum: ["mock", "live"] },
            model: string,
            domain: string,
            diseaseContext: string,
          }),
        ),
        responses: responses(ref("Config")),
      },
    },
    "/api/reports": {
      get: {
        summary: "List report history",
        responses: responses(object({ reports: array(ref("ReportSummary")) })),
      },
      post: {
        summary: "Upload for bounded local asynchronous extraction",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: object({ file: { type: "string", format: "binary" } }, [
                "file",
              ]),
            },
          },
        },
        responses: {
          "202": response(
            ref("Report"),
            "Accepted; poll report or job while processing",
          ),
          "413": error,
          "415": error,
          "429": error,
        },
      },
    },
    "/api/demo": {
      post: {
        summary: "Create a synthetic demonstration report",
        responses: responses(ref("Report"), "201"),
      },
    },
    "/api/reports/{id}": {
      get: {
        summary:
          "Read report, source anchors, fields, annotations and analysis",
        parameters: [parameter("id")],
        responses: responses(ref("Report")),
      },
    },
    "/api/jobs/{id}": {
      get: {
        summary: "Poll an extraction job",
        parameters: [parameter("id")],
        responses: responses(ref("Job")),
      },
    },
    ...reportRoutes,
    "/api/reports/{id}/annotations/{annotationId}": {
      delete: {
        summary: "Remove a manual annotation; original evidence is preserved",
        parameters: [parameter("id"), parameter("annotationId")],
        responses: responses(ref("Report")),
      },
    },
    "/api/reports/{id}/export": {
      get: {
        summary:
          "Export JSON, formula-safe CSV, or printable self-contained HTML",
        parameters: [
          parameter("id"),
          {
            name: "format",
            in: "query",
            schema: {
              type: "string",
              enum: ["json", "csv", "html"],
              default: "json",
            },
          },
        ],
        responses: {
          "200": {
            description: "Download or printable HTML",
            content: {
              ...json(ref("Report")),
              "text/csv": { schema: string },
              "text/html": { schema: string },
            },
          },
          "404": error,
        },
      },
    },
    "/api/reports/{id}/original": {
      get: {
        summary: "Download original locally stored upload",
        parameters: [parameter("id")],
        responses: {
          "200": { description: "Original upload attachment" },
          "404": error,
        },
      },
    },
    "/api/templates": {
      get: {
        summary: "List field templates",
        responses: responses(object({ templates: array(ref("Template")) })),
      },
      post: {
        summary: "Create reusable template",
        requestBody: body(templateInput),
        responses: responses(ref("Template"), "201"),
      },
    },
    "/api/templates/{id}": {
      put: {
        summary: "Replace template",
        parameters: [parameter("id")],
        requestBody: body(templateInput),
        responses: responses(ref("Template")),
      },
      delete: {
        summary: "Delete template",
        parameters: [parameter("id")],
        responses: responses(object({ ok: boolean })),
      },
    },
    "/api/rules": {
      get: {
        summary: "List numeric, range and qualitative rules",
        responses: responses(object({ rules: array(ref("Rule")) })),
      },
      post: {
        summary: "Create rule with explicit units",
        requestBody: body(ruleInput),
        responses: responses(ref("Rule"), "201"),
      },
    },
    "/api/rules/{id}": {
      put: {
        summary: "Replace rule",
        parameters: [parameter("id")],
        requestBody: body(ruleInput),
        responses: responses(ref("Rule")),
      },
      delete: {
        summary: "Delete rule",
        parameters: [parameter("id")],
        responses: responses(object({ ok: boolean })),
      },
    },
    "/api/history": {
      get: {
        summary: "Read privacy-safe operation history",
        responses: responses(object({ history: array(ref("History")) })),
      },
    },
    "/api/openapi.json": {
      get: {
        summary: "OpenAPI specification",
        responses: { "200": { description: "This specification" } },
      },
    },
    "/api/docs": {
      get: {
        summary: "Local Swagger UI, no external CDN",
        responses: { "200": { description: "Swagger UI HTML" } },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "med_report_session",
        description: "Eight-hour local demo session from POST /api/auth/login",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Optional script access when APP_TOKEN is set, accepted instead of a demo session. Does not disable admin/admin login.",
      },
    },
    schemas: {
      Config: object({
        mode: { enum: ["mock", "live"] },
        model: string,
        domain: string,
        diseaseContext: string,
        endpoint: string,
        keyConfigured: boolean,
        privacyWarning: string,
      }),
      Anchor: object(
        {
          id: string,
          page: { type: "integer" },
          line: { type: "integer" },
          text: string,
          method: { enum: ["text", "ocr", "docx", "doc", "manual"] },
        },
        ["id", "page", "line", "text", "method"],
      ),
      Candidate: object({
        id: string,
        label: string,
        value: { oneOf: [number, string], nullable: true },
        unit: string,
        referenceRange: { ...ref("ReferenceRange"), nullable: true },
        anchorIds: array(string),
        confidence: { enum: ["high", "medium", "low"] },
        status: { enum: ["normal", "high", "low", "abnormal", "uncertain"] },
        reason: string,
        source: { enum: ["extracted", "manual"] },
        ruleId: string,
      }),
      ReferenceRange: object({ low: number, high: number, text: string }),
      Annotation: object({
        id: string,
        ...annotationInput.properties,
        createdAt: string,
      }),
      Job: object({
        id: string,
        reportId: string,
        status: { enum: ["queued", "running", "complete", "error"] },
        createdAt: string,
        startedAt: string,
        finishedAt: string,
        error: string,
      }),
      ReportSummary: {
        ...object({
          id: string,
          filename: string,
          mime: string,
          size: { type: "integer" },
          status: { enum: ["processing", "ready", "needs_review", "error"] },
          createdAt: string,
          updatedAt: string,
          source: { enum: ["upload", "demo"] },
          candidateCount: { type: "integer" },
          warningCount: { type: "integer" },
          job: ref("Job"),
        }),
        additionalProperties: true,
      },
      Report: {
        allOf: [
          ref("ReportSummary"),
          {
            type: "object",
            properties: {
              text: string,
              anchors: array(ref("Anchor")),
              candidates: array(ref("Candidate")),
              annotations: array(ref("Annotation")),
              warnings: array(string),
              analysis: { ...ref("Analysis"), nullable: true },
              history: array(ref("History")),
            },
          },
        ],
      },
      TemplateField: object(
        { label: string, aliases: array(string), unit: string },
        ["label", "aliases"],
      ),
      Template: object({
        id: string,
        ...templateInput.properties,
        createdAt: string,
        updatedAt: string,
      }),
      Rule: object({
        id: string,
        ...ruleInput.properties,
        createdAt: string,
        updatedAt: string,
      }),
      History: object({
        id: string,
        reportId: { ...string, nullable: true },
        action: string,
        createdAt: string,
        detail: string,
      }),
      Preview: object({
        previewId: string,
        expiresAt: string,
        excerpts: array(object({ anchorId: string, text: string })),
        warnings: array(string),
        mode: { enum: ["mock", "live"] },
        model: string,
        endpoint: string,
        payload: { type: "object" },
      }),
      Analysis: object({
        id: string,
        mode: { enum: ["mock", "live"] },
        model: string,
        createdAt: string,
        summary: string,
        findings: array(object({ text: string, anchorIds: array(string) })),
        limitations: array(string),
        selectedAnchorIds: array(string),
        domain: string,
        diseaseContext: string,
      }),
    },
  },
};
