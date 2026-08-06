/**
 * Stable error codes. These cross the network to the voice agent, so they must
 * never leak database internals or passenger data. Messages are safe to speak aloud.
 */
export const ErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  BOOKING_NOT_FOUND: "BOOKING_NOT_FOUND",
  BOOKING_NOT_DISRUPTED: "BOOKING_NOT_DISRUPTED",
  NO_ALTERNATIVES: "NO_ALTERNATIVES",
  FLIGHT_UNAVAILABLE: "FLIGHT_UNAVAILABLE",
  INVALID_STATE: "INVALID_STATE",
  HOLD_EXPIRED: "HOLD_EXPIRED",
  CONFIRMATION_REQUIRED: "CONFIRMATION_REQUIRED",
  ALREADY_REBOOKED: "ALREADY_REBOOKED",
  /** Same idempotency key replayed with different confirmation data. */
  IDEMPOTENCY_MISMATCH: "IDEMPOTENCY_MISMATCH",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class DomainError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Never reveal *which* half of the credentials was wrong. */
export const invalidCredentials = () =>
  new DomainError(
    ErrorCode.INVALID_CREDENTIALS,
    "We could not match that booking reference and surname.",
  );
