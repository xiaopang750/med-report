# Verification

Run `bun test` from the repository root. `bun run check` also performs TypeScript checking and the production frontend build.

All test data is fabricated. Integration tests start their own loopback server on an OS-selected port, use disposable storage under the system temporary directory, use a fake API key, and remove their data after completion. Do not point the suite at a real service or real patient files.

## Test suites

- `evaluation.test.ts`: range boundaries, numeric/qualitative rules, mismatched and unsupported units, missing evidence, strict inequalities, ambiguous rules, OCR review requirements, source-linked overrides, file signatures and PNG expansion limits
- `integration.test.ts`: upload jobs, text/PDF/Word/OCR extraction, page and line anchors, annotations, template/rule CRUD, explicit consent, minimized AI previews, selection/configuration staleness, mock analysis, exports, audit privacy, origin checks, input and path protections, and local OpenAPI documentation
- `auth.test.ts`: optional bearer-token access, URL-token rejection, cross-origin mutation protections and private-file exposure checks
- `ai-protocol.test.ts`: an isolated subprocess replaces global fetch with an in-memory fake. It exercises provider payload shape, citation rejection, diagnostic/treatment filtering, invented measurements, one-use/expired previews, and provider error handling. It does not call any AI service or transmit data

PDF and OCR cases are skipped when their local tools are unavailable. Install Poppler (`pdftotext`, `pdfinfo`, `pdftoppm`) and Tesseract with `eng` and `chi_sim` to execute all cases. Chinese OCR is skipped without `chi_sim`. For a custom language directory, set `TESSDATA_PREFIX` before running the suite.

These tests are functional and security regression checks, not a clinical validation, OCR accuracy benchmark, penetration test, or a capacity/load benchmark for the 16-core/32-GB deployment target. Real GLM connectivity/credentials and legacy DOC extraction require separate environment-specific verification.
