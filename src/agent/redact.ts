/**
 * The trace is shown on screen and could be screenshotted or pasted into a bug
 * report, so passenger identifiers are masked before they reach it.
 */

export function maskReference(value: string): string {
  if (value.length <= 3) return "***";
  return `${value.slice(0, 2)}${"*".repeat(value.length - 3)}${value.slice(-1)}`;
}

export function maskName(value: string): string {
  if (value.length <= 1) return "*";
  return `${value.slice(0, 1)}${"*".repeat(Math.min(value.length - 1, 5))}`;
}

const SENSITIVE_KEYS = new Set(["lastName", "firstName", "surname", "email", "seatNumber"]);
const REFERENCE_KEYS = new Set(["bookingReference"]);
const SECRET_KEYS = new Set(["apiKey", "x-api-key", "authorization", "OPENAI_API_KEY", "TOOLS_API_KEY"]);

/** Deep-copies while masking. Never mutates the original. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key)) {
      output[key] = "[redacted]";
    } else if (typeof item === "string" && REFERENCE_KEYS.has(key)) {
      output[key] = maskReference(item);
    } else if (typeof item === "string" && SENSITIVE_KEYS.has(key)) {
      output[key] = maskName(item);
    } else {
      output[key] = redact(item);
    }
  }
  return output;
}
