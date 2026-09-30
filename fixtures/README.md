# Synthetic report fixtures

All report contents and identifying fields in this directory are fabricated. They must never be interpreted as health advice or a real person's medical information.

- `synthetic-expansion-limit.docx`: deliberately over-compressed synthetic ZIP for safe expansion-limit rejection
- `synthetic-report.txt`: local text extraction, numeric and qualitative values, fabricated identifier lines for redaction tests
- `synthetic-text.pdf`: two-page text PDF with stable page/line anchor checks
- `synthetic-table.docx`: native Word table with headings, numeric and qualitative results
- `synthetic-scan.png`: high-contrast English raster report for local Tesseract OCR
- `synthetic-chinese-scan.png`: synthetic Chinese raster report for local `chi_sim` OCR
- `synthetic-scan.pdf`: image-only PDF for rasterization + local OCR

The fixtures are committed so the test suite needs no Python packages. To regenerate them, use `python3 fixtures/generate.py` with Pillow, python-docx and ReportLab installed. The Chinese OCR test runs only when `chi_sim` is installed. The generation script also requires DejaVu Sans and Noto Sans CJK fonts. `pdftotext`, `pdftoppm` and Tesseract with `eng` are needed for all extraction tests to run.
