import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import mammoth from "mammoth";
import type { Anchor } from "./types";
import { AppError } from "./errors";
const envInt = (name: string, fallback: number, min: number, max: number) =>
  Math.min(
    max,
    Math.max(min, Number.parseInt(process.env[name] || "", 10) || fallback),
  );
export const LIMITS = {
  maxFileBytes: envInt("MAX_UPLOAD_MB", 20, 1, 100) * 1024 * 1024,
  maxPages: envInt("MAX_PAGES", 20, 1, 100),
  maxOcrPages: envInt("MAX_OCR_PAGES", 8, 1, 50),
  maxTextCharacters: 200000,
  commandTimeoutMs: envInt("EXTRACTION_TIMEOUT_MS", 25000, 1000, 120000),
  maxSelectedExcerpts: 40,
  concurrency: envInt("WORKER_CONCURRENCY", 2, 1, 8),
  maxQueue: envInt("MAX_QUEUE", 32, 1, 128),
  ocrThreads: envInt("OMP_THREAD_LIMIT", 2, 1, 4),
};
const runningProcesses = new Set<ReturnType<typeof Bun.spawn>>();
export function stopExtractionProcesses() {
  for (const proc of runningProcesses)
    try {
      proc.kill("SIGKILL");
    } catch {}
  runningProcesses.clear();
}
let capabilitiesCache: {
  pdftotext: boolean;
  pdfinfo: boolean;
  pdftoppm: boolean;
  tesseract: boolean;
  antiword: boolean;
  ocrLanguages: string[];
} | null = null;
export async function command(
  args: string[],
  timeout = LIMITS.commandTimeoutMs,
): Promise<string> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        HOME: process.env.HOME || "/tmp",
        TMPDIR: process.env.TMPDIR || "/tmp",
        ...(process.env.TESSDATA_PREFIX
          ? { TESSDATA_PREFIX: process.env.TESSDATA_PREFIX }
          : {}),
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        OMP_THREAD_LIMIT: String(LIMITS.ocrThreads),
      },
      stdin: "ignore",
    });
  } catch {
    throw new AppError(
      422,
      "TOOL_UNAVAILABLE",
      `Local extraction tool unavailable: ${args[0]}`,
    );
  }
  runningProcesses.add(proc);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeout);
  try {
    const [out, _err, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    if (timedOut)
      throw new AppError(
        422,
        "EXTRACTION_TIMEOUT",
        "Local extraction reached its time limit; split the document or use manual review",
      );
    if (code !== 0)
      throw new AppError(
        422,
        "EXTRACTION_FAILED",
        `Local ${args[0]} extraction failed; verify the file and installed tools`,
      );
    return out;
  } finally {
    clearTimeout(timer);
    runningProcesses.delete(proc);
  }
}
export async function capabilities() {
  if (capabilitiesCache) return capabilitiesCache;
  const has = (tool: string) => !!Bun.which(tool);
  let ocrLanguages: string[] = [];
  if (has("tesseract"))
    try {
      ocrLanguages = (await command(["tesseract", "--list-langs"], 5000))
        .split(/\r?\n/)
        .filter((x) => /^[a-z_]{2,20}$/.test(x));
    } catch {}
  capabilitiesCache = {
    pdftotext: has("pdftotext"),
    pdfinfo: has("pdfinfo"),
    pdftoppm: has("pdftoppm"),
    tesseract: has("tesseract"),
    antiword: has("antiword"),
    ocrLanguages,
  };
  return capabilitiesCache;
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const b = Buffer.from(bytes);
  let offset = 2;
  while (offset + 4 < b.length) {
    if (b[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (b[offset] === 0xff) offset++;
    const marker = b[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = b.readUInt16BE(offset);
    if (length < 2 || offset + length > b.length) break;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker) &&
      length >= 8
    )
      return {
        height: b.readUInt16BE(offset + 3),
        width: b.readUInt16BE(offset + 5),
      };
    offset += length;
  }
  return null;
}
export function verifyUpload(
  filename: string,
  bytes: Uint8Array,
): { extension: string; mime: string } {
  if (bytes.length === 0)
    throw new AppError(400, "EMPTY_FILE", "The uploaded file is empty");
  if (bytes.length > LIMITS.maxFileBytes)
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      `Maximum upload size is ${LIMITS.maxFileBytes / 1024 / 1024} MiB`,
    );
  const extension = filename.split(".").at(-1)?.toLowerCase() || "";
  const head = Buffer.from(bytes.subarray(0, 16));
  const valid: Record<string, [boolean, string]> = {
    pdf: [head.subarray(0, 5).toString() === "%PDF-", "application/pdf"],
    png: [
      head
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      "image/png",
    ],
    jpg: [head[0] === 255 && head[1] === 216 && head[2] === 255, "image/jpeg"],
    jpeg: [head[0] === 255 && head[1] === 216 && head[2] === 255, "image/jpeg"],
    docx: [
      head.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4])),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    doc: [
      head
        .subarray(0, 8)
        .equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])),
      "application/msword",
    ],
    txt: [!bytes.includes(0), "text/plain"],
  };
  const item = valid[extension];
  if (!item || !item[0])
    throw new AppError(
      415,
      "UNSUPPORTED_FILE",
      "Use a valid PDF, PNG, JPEG, DOCX, legacy DOC, or UTF-8 TXT file; extension and signature must match",
    );
  if (extension === "png" && bytes.length >= 24) {
    const width = Buffer.from(bytes).readUInt32BE(16),
      height = Buffer.from(bytes).readUInt32BE(20);
    if (width * height > 40000000)
      throw new AppError(
        413,
        "IMAGE_TOO_LARGE",
        "Image dimensions exceed 40 million pixels",
      );
  }
  if (extension === "jpg" || extension === "jpeg") {
    const dimensions = jpegDimensions(bytes);
    if (!dimensions)
      throw new AppError(
        422,
        "INVALID_IMAGE",
        "Unable to verify JPEG dimensions",
      );
    if (dimensions.width * dimensions.height > 40000000)
      throw new AppError(
        413,
        "IMAGE_TOO_LARGE",
        "Image dimensions exceed 40 million pixels",
      );
  }
  return { extension, mime: item[1] };
}
function validateDocxZip(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--)
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0)
    throw new AppError(422, "INVALID_DOCX", "Invalid DOCX ZIP container");
  const count = b.readUInt16LE(eocd + 10),
    offset = b.readUInt32LE(eocd + 16);
  if (count > 3000 || offset === 0xffffffff)
    throw new AppError(413, "DOCX_TOO_COMPLEX", "DOCX archive is too complex");
  let pos = offset,
    total = 0,
    hasDocument = false;
  for (let n = 0; n < count; n++) {
    if (pos + 46 > b.length || b.readUInt32LE(pos) !== 0x02014b50)
      throw new AppError(422, "INVALID_DOCX", "Invalid DOCX directory");
    const flags = b.readUInt16LE(pos + 8),
      compressed = b.readUInt32LE(pos + 20),
      size = b.readUInt32LE(pos + 24),
      nameLen = b.readUInt16LE(pos + 28),
      extraLen = b.readUInt16LE(pos + 30),
      commentLen = b.readUInt16LE(pos + 32);
    total += size;
    if (
      flags & 1 ||
      size === 0xffffffff ||
      total > 40 * 1024 * 1024 ||
      size > 15 * 1024 * 1024 ||
      (size > 1024 * 1024 && size / Math.max(compressed, 1) > 200)
    )
      throw new AppError(
        413,
        "DOCX_TOO_COMPLEX",
        "DOCX archive exceeds safe expansion limits",
      );
    const name = b.subarray(pos + 46, pos + 46 + nameLen).toString();
    if (name === "word/document.xml") hasDocument = true;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (!hasDocument)
    throw new AppError(
      422,
      "INVALID_DOCX",
      "The ZIP is not a Word DOCX document",
    );
}
function anchorsForPage(
  text: string,
  page: number,
  method: Anchor["method"],
): Anchor[] {
  return text
    .replace(/\r/g, "")
    .replace(/\x00/g, "")
    .split("\n")
    .map((value, index) => ({
      id: `p${page}-l${index + 1}`,
      page,
      line: index + 1,
      text: value.trimEnd(),
      method,
    }))
    .filter((x) => x.text.trim());
}
export async function extract(
  path: string,
  extension: string,
): Promise<{ text: string; anchors: Anchor[]; warnings: string[] }> {
  const caps = await capabilities(),
    warnings: string[] = [];
  let anchors: Anchor[] = [];
  const temp = await mkdtemp(join(tmpdir(), "report-local-"));
  let ocrPages = 0;
  const language = caps.ocrLanguages.includes("chi_sim")
    ? "chi_sim+eng"
    : "eng";
  const ocr = async (imagePath: string, page: number) => {
    if (!caps.tesseract) {
      warnings.push(
        `Page ${page}: OCR unavailable. Install Tesseract with chi_sim and eng; use manual review.`,
      );
      return [];
    }
    if (ocrPages >= LIMITS.maxOcrPages) {
      warnings.push(
        `Page ${page}: OCR skipped after ${LIMITS.maxOcrPages} page limit.`,
      );
      return [];
    }
    ocrPages++;
    if (language === "eng" && !warnings.some((x) => x.includes("chi_sim")))
      warnings.push(
        "Chinese OCR language chi_sim is not installed. English-only fallback may miss Chinese text; verify against the original.",
      );
    try {
      return anchorsForPage(
        await command([
          "tesseract",
          imagePath,
          "stdout",
          "-l",
          language,
          "--psm",
          "6",
        ]),
        page,
        "ocr",
      );
    } catch (err) {
      warnings.push(
        `Page ${page}: ${err instanceof AppError ? err.message : "OCR could not complete"}`,
      );
      return [];
    }
  };
  try {
    if (extension === "txt") {
      let text = await Bun.file(path).text();
      if (text.length > LIMITS.maxTextCharacters)
        warnings.push("Text was truncated at the configured extraction limit.");
      anchors = anchorsForPage(
        text.slice(0, LIMITS.maxTextCharacters),
        1,
        "text",
      );
    } else if (extension === "docx") {
      const buffer = Buffer.from(await Bun.file(path).arrayBuffer());
      validateDocxZip(buffer);
      const result = await mammoth.convertToHtml(
        { buffer },
        { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
      );
      const plain = result.value
        .replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) =>
          row.replace(/<\/p>/gi, " "),
        )
        .replace(/<\/(?:td|th)>/gi, " | ")
        .replace(/<\/(?:tr|p|h[1-6]|li)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      anchors = anchorsForPage(
        plain.slice(0, LIMITS.maxTextCharacters),
        1,
        "docx",
      );
      warnings.push(
        "DOCX anchors use extracted paragraph lines, not original printed page numbers. Embedded images are not OCR-processed.",
      );
      if (result.value.length > LIMITS.maxTextCharacters)
        warnings.push("Text was truncated at the configured extraction limit.");
      if (result.messages.length)
        warnings.push(
          "Word extraction reported unsupported content; verify the original document.",
        );
    } else if (extension === "doc") {
      if (!caps.antiword)
        throw new AppError(
          422,
          "TOOL_UNAVAILABLE",
          "Legacy DOC requires antiword. Install it or convert the file locally to DOCX/PDF.",
        );
      anchors = anchorsForPage(
        (await command(["antiword", "-w", "0", path])).slice(
          0,
          LIMITS.maxTextCharacters,
        ),
        1,
        "doc",
      );
      warnings.push(
        "Legacy DOC anchors use extracted lines, not original printed page numbers. Embedded images are not OCR-processed.",
      );
    } else if (extension === "pdf") {
      if (!caps.pdftotext || !caps.pdfinfo)
        throw new AppError(
          422,
          "TOOL_UNAVAILABLE",
          "PDF extraction requires local Poppler tools pdftotext and pdfinfo.",
        );
      const info = await command(["pdfinfo", path]);
      const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
      if (!pages || pages > 10000)
        throw new AppError(
          422,
          "INVALID_PDF",
          "Could not determine a safe PDF page count",
        );
      if (pages > LIMITS.maxPages)
        warnings.push(
          `Only the first ${LIMITS.maxPages} of ${pages} pages were processed. Split the document to review remaining pages.`,
        );
      for (let page = 1; page <= Math.min(pages, LIMITS.maxPages); page++) {
        const plain = await command([
          "pdftotext",
          "-f",
          String(page),
          "-l",
          String(page),
          "-layout",
          "-enc",
          "UTF-8",
          path,
          "-",
        ]);
        let chunk = anchorsForPage(plain, page, "text");
        const readable = plain.replace(/[^\p{L}\p{N}]/gu, "").length;
        if (readable < 25) {
          if (!caps.pdftoppm) {
            warnings.push(
              `Page ${page}: scanned page detected but pdftoppm is unavailable.`,
            );
          } else if (ocrPages < LIMITS.maxOcrPages) {
            try {
              const prefix = join(temp, `page-${page}`);
              await command([
                "pdftoppm",
                "-f",
                String(page),
                "-l",
                String(page),
                "-singlefile",
                "-scale-to",
                "2400",
                "-png",
                path,
                prefix,
              ]);
              const ocrChunk = await ocr(prefix + ".png", page);
              if (ocrChunk.length) chunk = ocrChunk;
            } catch {
              warnings.push(
                `Page ${page}: local rasterization failed; manually review the original.`,
              );
            }
          } else
            warnings.push(
              `Page ${page}: OCR skipped after ${LIMITS.maxOcrPages} page limit.`,
            );
        }
        anchors.push(...chunk);
        if (
          anchors.reduce((sum, a) => sum + a.text.length, 0) >
          LIMITS.maxTextCharacters
        ) {
          warnings.push(
            "Text extraction stopped at the configured character limit.",
          );
          break;
        }
      }
    } else {
      anchors = await ocr(path, 1);
    }
    let budget = LIMITS.maxTextCharacters;
    anchors = anchors
      .map((a) => {
        const text = a.text.slice(0, Math.max(0, budget));
        budget -= text.length;
        return { ...a, text };
      })
      .filter((a) => a.text);
    if (!anchors.length)
      warnings.push(
        "No readable text extracted. Review the original; this is not a normal result.",
      );
    if (anchors.some((a) => a.method === "ocr"))
      warnings.push(
        "OCR can confuse decimal points, symbols, units, and table columns. Every OCR candidate requires source verification.",
      );
    return {
      text: anchors.map((a) => a.text).join("\n"),
      anchors,
      warnings: [...new Set(warnings)],
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
