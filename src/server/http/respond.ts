import { ErrorCode, type DomainError } from "@/domain/errors";

/**
 * Statuses the voice platform can act on. 4xx means "the agent should say
 * something and carry on"; 5xx means "apologise and escalate".
 */
export const STATUS_BY_CODE: Record<string, number> = {
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.BOOKING_NOT_FOUND]: 404,
  [ErrorCode.BOOKING_NOT_DISRUPTED]: 409,
  [ErrorCode.NO_ALTERNATIVES]: 409,
  [ErrorCode.FLIGHT_UNAVAILABLE]: 409,
  [ErrorCode.INVALID_STATE]: 409,
  [ErrorCode.ALREADY_REBOOKED]: 409,
  [ErrorCode.IDEMPOTENCY_MISMATCH]: 409,
  [ErrorCode.HOLD_EXPIRED]: 410,
  [ErrorCode.CONFIRMATION_REQUIRED]: 422,
};

export interface SuccessBody<T> {
  ok: true;
  data: T;
}

export interface FailureBody {
  ok: false;
  code: string;
  /** Written to be spoken aloud verbatim. Never contains internal detail. */
  message: string;
  /** Only present on 500s, so a report can be tied to a log line. */
  requestId?: string;
}

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data } satisfies SuccessBody<T>, { status });
}

export function fail(
  code: string,
  message: string,
  status: number,
  requestId?: string,
): Response {
  const body: FailureBody = requestId
    ? { ok: false, code, message, requestId }
    : { ok: false, code, message };
  return Response.json(body, { status });
}

export function fromDomainError(error: DomainError): Response {
  return fail(error.code, error.message, STATUS_BY_CODE[error.code] ?? 409);
}
