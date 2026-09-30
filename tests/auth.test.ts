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

async function login(cookie?: string) {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ username: "admin", password: "admin" }),
  });
}
function cookieOf(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0]!;
}
describe("local demo admin session", () => {
  test("public session check and incorrect password never create a session", async () => {
    expect(await (await fetch(`${base}/api/auth/session`)).json()).toEqual({
      authenticated: false,
      username: null,
      demo: true,
    });
    for (const input of [
      { username: "admin", password: "wrong" },
      { username: "other", password: "admin" },
      { username: "admin" },
    ]) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("INVALID_CREDENTIALS");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });
  test("login issues opaque HttpOnly cookie and rotates an existing session", async () => {
    const response = await login("med_report_session=attacker-selected");
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      authenticated: true,
      username: "admin",
      demo: true,
    });
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain("attacker-selected");
    const first = cookieOf(response);
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie: first } })).ok,
    ).toBe(true);
    const second = cookieOf(await login(first));
    expect(second).not.toBe(first);
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie: first } }))
        .status,
    ).toBe(401);
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie: second } })).ok,
    ).toBe(true);
    expect(
      await (
        await fetch(`${base}/api/auth/session`, { headers: { cookie: second } })
      ).json(),
    ).toEqual({ authenticated: true, username: "admin", demo: true });
  });
  test("report APIs, originals, exports and documentation require authentication", async () => {
    for (const path of [
      "/reports",
      "/reports/not-found",
      "/reports/not-found/original",
      "/reports/not-found/export?format=json",
      "/templates",
      "/rules",
      "/history",
      "/config",
      "/jobs/not-found",
      "/docs",
      "/openapi.json",
    ]) {
      expect((await fetch(`${base}/api${path}`)).status).toBe(401);
      expect(
        (
          await fetch(`${base}/api${path}`, {
            headers: { cookie: "med_report_session=forged" },
          })
        ).status,
      ).toBe(401);
    }
    expect((await fetch(`${base}/api/demo`, { method: "POST" })).status).toBe(
      401,
    );
  });
  test("duplicate path separators cannot bypass the shared API auth boundary", async () => {
    for (const path of [
      "//api/templates",
      "//api/rules",
      "//api/reports/missing/original",
      "//api/reports/missing/export?format=json",
      "/api//reports",
      "///api/reports",
    ]) {
      expect((await fetch(base + path)).status).toBe(401);
    }
  });
  test("uploaded originals and exports work only while the session is valid", async () => {
    const cookie = cookieOf(await login());
    const form = new FormData();
    form.set(
      "file",
      new File(["Glucose 6.2 mmol/L 3.9-6.1"], "synthetic-auth.txt", {
        type: "text/plain",
      }),
    );
    const uploaded = await fetch(`${base}/api/reports`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(uploaded.status).toBe(202);
    const item = await uploaded.json();
    const id = item.report?.id ?? item.id;
    for (const path of [
      `/api/reports/${id}/original`,
      `/api/reports/${id}/export?format=json`,
    ]) {
      expect((await fetch(base + path)).status).toBe(401);
      expect((await fetch(base + path, { headers: { cookie } })).ok).toBe(true);
    }
    await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(
      (
        await fetch(`${base}/api/reports/${id}/original`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/reports/${id}/export?format=json`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(401);
  });
  test("logout clears cookie, revokes server session and is idempotent", async () => {
    const cookie = cookieOf(await login());
    const logout = await fetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.ok).toBe(true);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie } })).status,
    ).toBe(401);
    expect(
      (
        await (
          await fetch(`${base}/api/auth/session`, { headers: { cookie } })
        ).json()
      ).authenticated,
    ).toBe(false);
    expect(
      (
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { cookie },
        })
      ).ok,
    ).toBe(true);
    const next = cookieOf(await login());
    expect(next).not.toBe(cookie);
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie: next } })).ok,
    ).toBe(true);
  });
  test("cross-origin login and logout are rejected without invalidating session", async () => {
    const cookie = cookieOf(await login());
    expect(
      (
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { cookie, "sec-fetch-site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    for (const path of ["login", "logout"]) {
      const response = await fetch(`${base}/api/auth/${path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://untrusted.invalid",
          "content-type": "application/json",
        },
        body: JSON.stringify({ username: "admin", password: "admin" }),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(
      (await fetch(`${base}/api/reports`, { headers: { cookie } })).ok,
    ).toBe(true);
  });
});
