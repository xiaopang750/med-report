export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function bad(message: string, code = "INVALID_INPUT"): never {
  throw new AppError(400, code, message);
}
export function str(
  value: unknown,
  label: string,
  max = 200,
  required = true,
): string {
  if (value == null && !required) return "";
  if (
    typeof value !== "string" ||
    (required && !value.trim()) ||
    value.length > max
  )
    bad(
      `${label} must be ${required ? "a nonempty" : "a"} string (max ${max} characters)`,
    );
  return value.trim();
}
export function finite(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    bad(`${label} must be a finite number`);
  return value;
}
export function strings(value: unknown, label: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max)
    bad(`${label} must be an array with at most ${max} items`);
  return [...new Set(value.map((x) => str(x, label, 200)))];
}
