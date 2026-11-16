const statuses = new Set(["invalid_api_key", "quota_exceeded", "too_many_concurrent_requests", "system_busy"] as const);
export type ProviderStatus = "invalid_api_key" | "quota_exceeded" | "too_many_concurrent_requests" | "system_busy";

/** Recognize documented status tokens; never retain arbitrary upstream text. */
export function safeProviderStatus(value: unknown): ProviderStatus | undefined {
  if (typeof value === "string") {
    if (value.length > 2048) return undefined;
    const text = value.trim();
    if (text.startsWith("{")) {
      try { return safeProviderStatus(JSON.parse(text)); } catch { return undefined; }
    }
    // A bare code or a code followed by ': message'. Do not search messages,
    // URLs, headers, or credential values for words that resemble a status.
    const token = /^([a-z_]+)(?::(?:\s|$)|$)/.exec(text)?.[1];
    return token && statuses.has(token as ProviderStatus) ? token as ProviderStatus : undefined;
  }
  if (!value || typeof value !== "object" || !("detail" in value)) return undefined;
  const detail = value.detail;
  if (!detail || typeof detail !== "object" || !("status" in detail) || typeof detail.status !== "string") return undefined;
  return statuses.has(detail.status as ProviderStatus) ? detail.status as ProviderStatus : undefined;
}
