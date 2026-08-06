import { AuditAction } from "../../domain/constants";
import { DomainError, ErrorCode } from "../../domain/errors";
import { assertTransitionAllowed } from "../../domain/rebooking-state";
import { prisma } from "../db/prisma";
import * as sessionRepository from "../repositories/session-repository";
import * as supportRepository from "../repositories/support-repository";
import * as auditService from "./audit-service";

export const EscalationReason = {
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  NO_ALTERNATIVE_FLIGHTS: "NO_ALTERNATIVE_FLIGHTS",
  PASSENGER_REQUEST: "PASSENGER_REQUEST",
  POLICY_EXCEPTION: "POLICY_EXCEPTION",
  BACKEND_ERROR: "BACKEND_ERROR",
} as const;

export type EscalationReason = (typeof EscalationReason)[keyof typeof EscalationReason];

export interface EscalateInput {
  sessionId: string;
  reason: EscalationReason;
}

export interface EscalateResult {
  reference: string;
  escalatedFromState: string;
  reason: EscalationReason;
}

/**
 * Hands the conversation to a human. Reachable from every state except the two
 * terminal ones. The state we escalated *from* is recorded on the support case,
 * not duplicated onto the session.
 */
export async function escalateSession(input: EscalateInput): Promise<EscalateResult> {
  return prisma.$transaction(async (tx) => {
    const session = await sessionRepository.findById(tx, input.sessionId);
    if (!session) {
      throw new DomainError(ErrorCode.INVALID_STATE, "Unknown session.");
    }

    assertTransitionAllowed(session.state, "ESCALATED");

    const supportCase = await supportRepository.create(tx, {
      sessionId: session.id,
      reason: input.reason,
      escalatedFromState: session.state,
    });

    await sessionRepository.transition(tx, session.id, "ESCALATED");

    await auditService.record(tx, session.id, AuditAction.HUMAN_TRANSFER_REQUESTED, {
      reason: input.reason,
      escalatedFromState: session.state,
      supportCaseId: supportCase.id,
    });

    return {
      reference: supportCase.id,
      escalatedFromState: supportCase.escalatedFromState,
      reason: input.reason,
    };
  });
}
