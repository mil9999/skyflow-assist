import { DomainError, ErrorCode } from "./errors";

/**
 * The only legal moves. Every service must call assertTransitionAllowed before
 * writing a new session state, so an LLM can never talk the system into a shortcut.
 */
export const allowedTransitions: Record<string, readonly string[]> = {
  UNVERIFIED: ["VERIFIED", "ESCALATED"],
  VERIFIED: ["BOOKING_LOADED", "ESCALATED"],
  BOOKING_LOADED: ["OPTIONS_PRESENTED", "ESCALATED"],
  OPTIONS_PRESENTED: ["OPTION_HELD", "ESCALATED"],
  OPTION_HELD: ["AWAITING_CONFIRMATION", "OPTIONS_PRESENTED", "ESCALATED"],
  AWAITING_CONFIRMATION: ["REBOOKED", "OPTIONS_PRESENTED", "ESCALATED"],
  REBOOKED: [],
  ESCALATED: [],
};

export function canTransition(from: string, to: string): boolean {
  return (allowedTransitions[from] ?? []).includes(to);
}

export function assertTransitionAllowed(currentState: string, nextState: string): void {
  if (!canTransition(currentState, nextState)) {
    throw new DomainError(
      ErrorCode.INVALID_STATE,
      `Cannot move from ${currentState} to ${nextState}.`,
    );
  }
}
