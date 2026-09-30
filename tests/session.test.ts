import { expect, test } from "bun:test";
import { DemoSessions, SESSION_TTL_MS, sessionCookie } from "../server/auth";
test("demo sessions expire after eight hours and restart starts empty", () => {
  let now = 1000;
  const sessions = new DemoSessions(() => now);
  const id = sessions.create();
  expect(id).toMatch(/^[a-f0-9]{64}$/);
  expect(sessions.valid(id)).toBe(true);
  expect(new DemoSessions().valid(id)).toBe(false);
  now += SESSION_TTL_MS;
  expect(sessions.valid(id)).toBe(false);
  expect(sessions.valid(undefined)).toBe(false);
});
test("HTTPS session cookies are Secure; local HTTP does not trust forwarded headers", () => {
  expect(
    sessionCookie(new Request("https://localhost/api/auth/login"), "id"),
  ).toContain("; Secure");
  expect(
    sessionCookie(
      new Request("http://localhost/api/auth/login", {
        headers: { "x-forwarded-proto": "https" },
      }),
      "id",
    ),
  ).not.toContain("; Secure");
});
