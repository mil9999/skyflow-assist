import { randomUUID } from "node:crypto";

import type { z } from "zod";

import { isDomainError } from "@/domain/errors";
import { assertApiKey } from "./auth";
import { fail, fromDomainError, ok } from "./respond";

/**
 * Wraps a service call in the same four steps every time:
 * authenticate, validate, run, translate the outcome into HTTP.
 *
 * Nothing here knows any airline rules — that is the whole point.
 */
export function toolRoute<Schema extends z.ZodTypeAny, Result>(
  routeName: string,
  schema: Schema,
  run: (input: z.infer<Schema>) => Promise<Result>,
) {
  return async function POST(request: Request): Promise<Response> {
    try {
      assertApiKey(request);
    } catch {
      // Deliberately identical for a missing, malformed or wrong key.
      return fail("UNAUTHORIZED", "Not authorised.", 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail("BAD_REQUEST", "The request body must be valid JSON.", 400);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") || "body";
      return fail("BAD_REQUEST", `Invalid request: ${where} — ${issue?.message ?? "invalid"}.`, 400);
    }

    try {
      return ok(await run(parsed.data));
    } catch (error) {
      // Expected refusals carry a safe, speakable message and a known status.
      if (isDomainError(error)) {
        return fromDomainError(error);
      }

      // Unexpected errors can carry request values — booking references,
      // surnames, query parameters — inside their message and stack. Only the
      // error's class name is ever logged, in every environment.
      const requestId = randomUUID();
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(`[tools:${routeName}] ${errorName} requestId=${requestId}`);

      return fail("INTERNAL_ERROR", "Something went wrong on our side.", 500, requestId);
    }
  };
}
