# Report Studio API contract
All routes `/api`; JSON `{error,code}` on failure. IDs strings. All report parsing local. No auth in loopback-only default; set APP_TOKEN for Bearer authentication. Browser mutations must same-origin; development proxy allowed through APP_ORIGIN. Config cannot expose/write key.

- `GET /api/health` -> `{ok,version,mode,capabilities:{pdftotext,pdftoppm,tesseract,antiword,ocrLanguages},limits}`
- `GET /api/config` -> `{mode:'mock'|'live',model,endpoint,keyConfigured,domain,diseaseContext,privacyWarning}`
- `PUT /api/config` `{mode?,model?,domain?,diseaseContext?}` -> same
- `GET /api/reports` -> `{reports: ReportSummary[]}`
- `POST /api/reports` multipart `file` -> Report detail (HTTP 202; bounded background extraction queue)
- `POST /api/demo` -> synthetic seeded Report detail
- `GET /api/reports/:id` -> Report detail
Report summary `{id,filename,mime,size,status:'processing'|'ready'|'needs_review'|'error',createdAt,updatedAt,source:'upload'|'demo',candidateCount,warningCount}`
Report detail adds `{text,anchors:Anchor[],candidates:Candidate[],annotations:Annotation[],warnings:string[],analysis:Analysis|null,history:History[]}`
Anchor `{id,page,line,text,method:'text'|'ocr'|'docx'|'doc'|'manual'}`; IDs stable, `p1-l1` etc. Candidate `{id,label,value:number|string|null,unit,referenceRange:{low?:number,high?:number,text:string}|null,anchorIds:string[],confidence:'high'|'medium'|'low',status:'normal'|'high'|'low'|'abnormal'|'uncertain',reason,source:'extracted'|'manual',ruleId?:string}`
- `POST /api/reports/:id/annotations` `{anchorId,label,value,unit?,referenceLow?,referenceHigh?,note?}` -> Report detail (creates/updates candidate, immutable source text)
- `DELETE /api/reports/:id/annotations/:annotationId` -> Report detail
- `GET /api/templates` -> `{templates:Template[]}`
- `POST /api/templates` `{name,domain?,fields:[{label,aliases:string[],unit?}]}` -> Template
- `PUT /api/templates/:id` same -> Template
- `DELETE /api/templates/:id` -> `{ok:true}`
Template `{id,name,domain,fields,createdAt,updatedAt}`
- `POST /api/reports/:id/apply-template` `{templateId}` -> Report detail
- `GET /api/rules` -> `{rules:Rule[]}`
- `POST /api/rules` / `PUT /api/rules/:id` `{name,label,aliases?:string[],kind:'numeric'|'qualitative'|'range',unit?:string,low?:number,high?:number,normalValues?:string[],abnormalValues?:string[],enabled?:boolean,domain?:string}` -> Rule
- `DELETE /api/rules/:id` -> `{ok:true}`
- `POST /api/reports/:id/evaluate` -> Report detail
- `POST /api/reports/:id/ai-preview` `{anchorIds:string[]}` -> `{previewId,expiresAt,excerpts:[{anchorId,text}],warnings:string[],mode,model,endpoint}`. Default select none; server deidentifies selected lines and drops identifier-only lines. Excerpts + config snapshot hashed and saved; live preview requires at least one safe line. Preview has 10 minute expiry.
- `POST /api/reports/:id/analyze` `{previewId,consent:true,anchorIds:string[]}` -> Report detail. Exact IDs must match preview. Never accepts client text; reuses stored redacted preview only. Explicit consent also required in mock. Mock default, live only config + GLM_API_KEY env. Analysis `{id,mode,model,createdAt,summary,findings:[{text,anchorIds}],limitations:string[],selectedAnchorIds:string[],domain,diseaseContext}`. Validate model output citations against selected IDs; unsupported claims marked uncertain. Analysis informational, no diagnosis/treatment.
- `GET /api/reports/:id/export?format=json|csv|html` -> attachment JSON/CSV or printable self-contained HTML
- `GET /api/history` -> `{history:[{id,reportId,action,createdAt,detail}]}`
- `GET /api/openapi.json`; `GET /api/docs` -> locally served Swagger UI

Annotation `{id,anchorId,label,value,unit,referenceLow?,referenceHigh?,note,createdAt}`. History contains action metadata only (no raw text/key). Demo auto-seeded once at startup. Frontend should display uncertainties and privacy warning prominently; preview includes only selected deidentified excerpts and is required before analyze.

## Background extraction
Upload returns HTTP 202 with processing report and job. Poll report or GET /api/jobs/:id. Job `{id,reportId,status:queued|running|complete|error,createdAt,startedAt?,finishedAt?,error?}`. Reports retain `job` state. Default WORKER_CONCURRENCY=2, MAX_QUEUE=32, MAX_UPLOAD_MB=20, MAX_PAGES=20, MAX_OCR_PAGES=8. Queue full HTTP429; restart marks unfinished reports error for safe resubmission. OCR uses OMP_THREAD_LIMIT=2; no GPU assumed.

## Privacy and context
AI preview includes `payload` with the exact provider JSON body; the API key is never included. Selected evidence is reconstructed from recognized clinical fields, numeric or allowlisted qualitative values, supported units, and safe structured bounds. Unrecognized free text is withheld. Original source text and identifiers are never forwarded. Clinical context is allowlisted by keyword for egress; full user-defined context remains local. Preview warnings explicitly disclose omitted context. Live output must cite approved anchors and numeric tokens must occur in cited evidence; any remaining narrative must be manually verified.
