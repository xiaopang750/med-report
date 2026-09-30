import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";

const directory = mkdtempSync(join(tmpdir(), "report-studio-auth-tests-"));
const token = "synthetic-auth-test-token";
let processHandle: Subprocess | undefined;
let base: string;
let startupLog = "";

beforeAll(async () => {
  const probe = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(),
  });
  const port = probe.port;
  probe.stop(true);
  base = `http://127.0.0.1:${port}`;
  processHandle = Bun.spawn([process.execPath, "server/index.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_TOKEN: token,
      APP_ORIGIN: base,
      DATA_DIR: join(directory, "data"),
      FILE_DIR: join(directory, "file"),
      LOG_DIR: join(directory, "logs"),
      GLM_API_KEY: "synthetic-fake-key",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  void new Response(processHandle.stdout as ReadableStream<Uint8Array>)
    .text()
    .then((text) => {
      startupLog += text;
    });
  void new Response(processHandle.stderr as ReadableStream<Uint8Array>)
    .text()
    .then((text) => {
      startupLog += text;
    });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if (
        (
          await fetch(`${base}/api/health`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).ok
      )
        return;
    } catch {
      /* starting */
    }
    if (processHandle.exitCode !== null)
      throw new Error(`Authenticated test server exited: ${startupLog}`);
    await Bun.sleep(100);
  }
  throw new Error(`Authenticated test server did not start: ${startupLog}`);
}, 35_000);
afterAll(async () => {
  processHandle?.kill();
  if (processHandle)
    await Promise.race([processHandle.exited, Bun.sleep(5000)]);
  rmSync(directory, { recursive: true, force: true });
});

describe("optional application access token", () => {
  test("requires bearer authentication for report data", async () => {
    for (const path of ["/api/reports", "/api/config", "/api/history"]) {
      expect((await fetch(base + path)).status).toBe(401);
      expect(
        (
          await fetch(base + path, {
            headers: { authorization: "Bearer wrong-token" },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(base + path, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).ok,
      ).toBe(true);
    }
  });
  test("does not accept token in URL query or expose secrets in config", async () => {
    expect((await fetch(`${base}/api/reports?token=${token}`)).status).toBe(
      401,
    );
    const response = await fetch(`${base}/api/config`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    expect(text).not.toContain(token);
    expect(text).not.toContain("synthetic-fake-key");
  });
  test("authorization does not bypass cross-origin mutation checks", async () => {
    const response = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        origin: "https://untrusted.invalid",
        "content-type": "application/json",
      },
      body: JSON.stringify({ diseaseContext: "untrusted change" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
  test("runtime database, source code and environment files are not public downloads", async () => {
    for (const path of [
      "/data/reports.sqlite",
      "/file/",
      "/logs/operations.jsonl",
      "/.env",
      "/server/index.ts",
      "/server/db.ts",
    ]) {
      const response = await fetch(base + path);
      const text = await response.text();
      expect(text).not.toContain("SQLite format 3");
      expect(text).not.toContain("GLM_API_KEY=");
      expect(text).not.toContain("synthetic-fake-key");
      expect(text).not.toContain("from 'bun:sqlite'");
      expect(text).not.toContain("process.env.APP_TOKEN");
    }
  });
});
