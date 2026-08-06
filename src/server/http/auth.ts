import { createHash, timingSafeEqual } from "node:crypto";

export class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnauthorizedError";
  }
}

/**
 * Hashing both sides first means the buffers are always 32 bytes, so the
 * comparison neither throws on a length mismatch nor leaks the key's length.
 */
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

let warnedAboutMissingKey = false;

export function assertApiKey(request: Request): void {
  const expected = process.env.TOOLS_API_KEY;

  // Fail closed. An unset key rejects everything rather than allowing everything.
  if (!expected || expected.trim().length === 0) {
    if (!warnedAboutMissingKey) {
      warnedAboutMissingKey = true;
      console.error("[tools] TOOLS_API_KEY is not set — rejecting all tool requests.");
    }
    throw new UnauthorizedError("server key not configured");
  }

  const provided = request.headers.get("x-api-key");
  if (!provided) {
    throw new UnauthorizedError("missing header");
  }

  if (!timingSafeEqual(digest(provided), digest(expected))) {
    throw new UnauthorizedError("key mismatch");
  }
}
