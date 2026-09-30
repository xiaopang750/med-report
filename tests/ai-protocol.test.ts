import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "report-studio-ai-tests-"));
let results: { name: string; ok: boolean; error?: string }[] = [];
beforeAll(async () => {
  // The worker replaces global fetch with a local in-memory function. Nothing is
  // transmitted, even though protocol validation exercises the live branch.
  const child = Bun.spawn([process.execPath, "tests/ai-protocol-worker.ts"], {
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      DATA_DIR: join(directory, "data"),
      FILE_DIR: join(directory, "file"),
      LOG_DIR: join(directory, "logs"),
      GLM_API_KEY: "synthetic-dummy-key",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exit !== 0)
    throw new Error(`Isolated AI protocol worker exited ${exit}: ${stderr}`);
  results = JSON.parse(stdout);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe("AI protocol with a fully mocked transport", () => {
  test.each([
    "transmits only the previewed minimized payload and never identifier-only lines",
    "invalid citations and diagnostic or treatment instructions are not accepted",
    "invented measurement values with real citations are rejected or explicitly uncertain",
    "expired previews fail before any network transmission",
    "malformed model JSON is rejected and response text is not exposed in errors",
    "provider errors do not expose private provider response bodies",
  ])("%s", (name) => {
    const result = results.find((item) => item.name === name);
    if (!result?.ok)
      throw new Error(
        `${name}: ${result?.error ?? "Worker did not report this case"}`,
      );
    expect(result.ok).toBe(true);
  });
});
