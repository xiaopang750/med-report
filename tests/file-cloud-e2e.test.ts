import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const root = import.meta.dir + "/..";
test("live transport protocol is mocked: no real key or network", async () => {
  const child = Bun.spawn([process.execPath, "tests/file-provider-worker.ts"], {
    cwd: root,
    env: {
      ...process.env,
      GLM_FILE_PROVIDER: "live",
      GLM_FILE_API_KEY: "fictional-test-only",
      GLM_FILE_TIMEOUT_MS: "1000",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(err).toBe("");
  expect(exit).toBe(0);
  expect(out).toContain("passed");
});
test("no system tools: cookie auth + file-bound consent + PNG/PDF/DOCX mock workflow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "med-cloud-"));
  const proc = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PATH: dir,
      PORT: "0",
      HOST: "127.0.0.1",
      DATA_DIR: join(dir, "data"),
      FILE_DIR: join(dir, "files"),
      LOG_DIR: join(dir, "logs"),
      APP_TOKEN: "",
      PARSING_MODE: "local",
      AI_MODE: "mock",
      GLM_FILE_PROVIDER: "mock",
      GLM_FILE_API_KEY: "",
      GLM_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  let cookie = "";
  try {
    const reader = proc.stdout.getReader();
    const chunk = await reader.read();
    const output = new TextDecoder().decode(chunk.value);
    const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    expect(base).toBeDefined();
    const api = (path: string, init: RequestInit = {}) =>
      fetch(base + "/api" + path, {
        ...init,
        headers: {
          ...(init.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          cookie,
          ...init.headers,
        },
      });
    expect(
      (await api("/parsing/preview", { method: "POST", body: "{}" })).status,
    ).toBe(401);
    const login = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const health = await (await api("/health")).json();
    expect(health.capabilities.tesseract).toBe(false);
    expect(health.capabilities.pdftotext).toBe(false);
    for (const name of [
      "synthetic-scan.png",
      "synthetic-text.pdf",
      "synthetic-table.docx",
    ]) {
      const bytes = await Bun.file(root + "/fixtures/" + name).arrayBuffer();
      const form = new FormData();
      form.set("file", new File([bytes], name));
      form.set("mode", "glm");
      expect(
        (await api("/reports", { method: "POST", body: form })).status,
      ).toBe(403);
      const p = await (
        await api("/parsing/preview", {
          method: "POST",
          body: JSON.stringify({
            mode: "glm",
            filename: name,
            size: bytes.byteLength,
            sha256: createHash("sha256")
              .update(new Uint8Array(bytes))
              .digest("hex"),
          }),
        })
      ).json();
      form.set("previewId", p.previewId);
      form.set("consent", "true");
      const res = await api("/reports", { method: "POST", body: form });
      expect(res.status).toBe(202);
      let r = await res.json();
      for (let i = 0; i < 100 && r.status === "processing"; i++) {
        await Bun.sleep(20);
        r = await (await api("/reports/" + r.id)).json();
      }
      expect(r.status).toBe("needs_review");
      expect(r.anchors[0].page).toBeNull();
      expect(r.warnings.join()).toContain("MOCK");
      expect(r.candidates[0].confidence).toBe("low");
      expect(
        (await api("/reports", { method: "POST", body: form })).status,
      ).toBe(403);
      expect((await api("/reports/" + r.id + "/original")).status).toBe(200);
      const annotation = await api("/reports/" + r.id + "/annotations", {
        method: "POST",
        body: JSON.stringify({
          anchorId: r.anchors[1].id,
          label: "Glucose",
          value: 6.2,
          unit: "mmol/L",
          referenceLow: 3.9,
          referenceHigh: 6.1,
          note: "虚构人工校对",
        }),
      });
      expect(annotation.status).toBe(201);
    }
    const form = new FormData();
    form.set(
      "file",
      new File(
        [await Bun.file(root + "/fixtures/synthetic-text.pdf").arrayBuffer()],
        "local.pdf",
      ),
    );
    form.set("mode", "local");
    let r = await (
      await api("/reports", { method: "POST", body: form })
    ).json();
    for (let i = 0; i < 100 && r.status === "processing"; i++) {
      await Bun.sleep(20);
      r = await (await api("/reports/" + r.id)).json();
    }
    expect(r.status).toBe("error");
    expect(r.warnings.join()).toContain("Poppler");
    expect(r.anchors).toEqual([]);
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(dir, { recursive: true, force: true });
  }
}, 15000);

test("Bun loads root .env for local dev without frontend variables", async () => {
  const dir = mkdtempSync(join(tmpdir(), "med-dotenv-"));
  try {
    await Bun.write(
      join(dir, ".env"),
      "PARSING_MODE=glm\nGLM_FILE_PROVIDER=mock\nGLM_FILE_API_KEY=\n",
    );
    const env = { ...process.env };
    delete env.PARSING_MODE;
    delete env.GLM_FILE_PROVIDER;
    delete env.GLM_FILE_API_KEY;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {fileConfig} from ${JSON.stringify(root + "/server/file-parser.ts")}; console.log(JSON.stringify(fileConfig()))`,
      ],
      { cwd: dir, env, stdout: "pipe", stderr: "pipe" },
    );
    const [exit, out] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
    ]);
    expect(exit).toBe(0);
    const config = JSON.parse(out);
    expect(config.defaultMode).toBe("glm");
    expect(config.provider).toBe("mock");
    expect(config.keyConfigured).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
