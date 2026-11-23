import { DomainError, ErrorCode } from "../../domain/errors";

/** Actor comes from trusted server code, never from model or webhook input. */
export type ServiceActor = "AI" | "EMPLOYEE" | "SYSTEM";

export function assertSessionActor(session: { controller: string }, actor: ServiceActor = "AI") {
  if (actor === "AI" && session.controller !== "AI") {
    throw new DomainError(ErrorCode.SESSION_TAKEN_OVER, "An employee has taken over. Stop automated booking actions and continue in the employee text conversation.");
  }
  if (actor === "EMPLOYEE" && session.controller !== "EMPLOYEE") {
    throw new DomainError(ErrorCode.TAKEOVER_REQUIRED, "Take over this conversation before making changes.");
  }
}
