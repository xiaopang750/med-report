import { randomBytes } from "node:crypto";

// Deliberately public demo credentials. This is not production authentication.
export const SESSION_COOKIE = "med_report_session";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export class DemoSessions {
  private sessions = new Map<string, number>();
  constructor(private now = () => Date.now()) {}
  valid(id: string | undefined) {
    if (!id) return false;
    const expires = this.sessions.get(id);
    if (!expires || expires <= this.now()) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }
  create(previous?: string) {
    this.revoke(previous);
    for (const [id, expires] of this.sessions)
      if (expires <= this.now()) this.sessions.delete(id);
    // Bound memory even when a demo client logs in repeatedly.
    if (this.sessions.size >= 1000)
      this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    this.sessions.set(id, this.now() + SESSION_TTL_MS);
    return id;
  }
  revoke(id: string | undefined) {
    if (id) this.sessions.delete(id);
  }
}
export const sessions = new DemoSessions();
export function sessionId(req: Request) {
  const cookies = (req.headers.get("cookie") || "").split(";");
  return cookies
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
export function sessionCookie(req: Request, id: string, clear = false) {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_TTL_MS / 1000}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
