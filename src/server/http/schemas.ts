import { z } from "zod";

/** Works across zod versions and accepts anything Date can parse. */
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO date-time");

const id = z.string().min(1);

export const startSessionSchema = z.object({
  channel: z.enum(["TEXT", "VOICE"]).optional(),
});

export const verifyPassengerSchema = z.object({
  sessionId: id,
  // Length caps only — normalisation happens in the domain layer.
  bookingReference: z.string().min(1).max(40),
  lastName: z.string().min(1).max(80),
});

export const getBookingSchema = z.object({
  sessionId: id,
});

export const searchFlightsSchema = z.object({
  sessionId: id,
  latestArrivalTime: isoDateTime.optional(),
  directOnly: z.boolean().optional(),
});

export const holdFlightSchema = z.object({
  sessionId: id,
  flightId: id,
});

export const cancelHoldSchema = z.object({
  sessionId: id,
  holdId: id,
});

export const confirmRebookingSchema = z.object({
  sessionId: id,
  holdId: id,
  // Must be a real boolean. "yes", "true" and 1 are all rejected.
  confirmed: z.boolean(),
  idempotencyKey: z.string().min(8).max(200),
});

export const escalateSchema = z.object({
  sessionId: id,
  reason: z.enum([
    "VERIFICATION_FAILED",
    "NO_ALTERNATIVE_FLIGHTS",
    "PASSENGER_REQUEST",
    "POLICY_EXCEPTION",
    "BACKEND_ERROR",
  ]),
});
