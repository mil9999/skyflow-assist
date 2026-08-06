import type { DatabaseClient } from "../db/prisma";

export function create(db: DatabaseClient, channel: "TEXT" | "VOICE" = "TEXT") {
  return db.conversationSession.create({
    data: { state: "UNVERIFIED", channel },
  });
}

export function findById(db: DatabaseClient, id: string) {
  return db.conversationSession.findUnique({ where: { id } });
}

export function findByActiveHold(db: DatabaseClient, holdId: string) {
  return db.conversationSession.findFirst({ where: { activeHoldId: holdId } });
}

export interface TransitionData {
  bookingId?: string;
  /** null clears the hold, undefined leaves it alone. */
  activeHoldId?: string | null;
}

/**
 * Writes the new state. Callers must have already run assertTransitionAllowed —
 * this function deliberately does not know the rules, only how to persist them.
 */
export function transition(
  db: DatabaseClient,
  id: string,
  nextState: string,
  data: TransitionData = {},
) {
  return db.conversationSession.update({
    where: { id },
    data: { state: nextState, ...data },
  });
}
