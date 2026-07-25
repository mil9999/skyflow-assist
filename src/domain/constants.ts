export const FlightStatus = {
  SCHEDULED: "SCHEDULED",
  DELAYED: "DELAYED",
  CANCELLED: "CANCELLED",
  DEPARTED: "DEPARTED",
} as const;
export type FlightStatus = (typeof FlightStatus)[keyof typeof FlightStatus];

export const BookingStatus = {
  ACTIVE: "ACTIVE",
  DISRUPTED: "DISRUPTED",
  HELD: "HELD",
  REBOOKED: "REBOOKED",
  CANCELLED: "CANCELLED",
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

export const HoldStatus = {
  ACTIVE: "ACTIVE",
  CONFIRMED: "CONFIRMED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
} as const;
export type HoldStatus = (typeof HoldStatus)[keyof typeof HoldStatus];

export const SessionState = {
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
  BOOKING_LOADED: "BOOKING_LOADED",
  OPTIONS_PRESENTED: "OPTIONS_PRESENTED",
  OPTION_HELD: "OPTION_HELD",
  AWAITING_CONFIRMATION: "AWAITING_CONFIRMATION",
  REBOOKED: "REBOOKED",
  ESCALATED: "ESCALATED",
} as const;
export type SessionState = (typeof SessionState)[keyof typeof SessionState];

export const AuditAction = {
  SESSION_STARTED: "SESSION_STARTED",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  PASSENGER_VERIFIED: "PASSENGER_VERIFIED",
  BOOKING_RETRIEVED: "BOOKING_RETRIEVED",
  ALTERNATIVES_SEARCHED: "ALTERNATIVES_SEARCHED",
  FLIGHT_HELD: "FLIGHT_HELD",
  HOLD_EXPIRED: "HOLD_EXPIRED",
  REBOOKING_CONFIRMED: "REBOOKING_CONFIRMED",
  ITINERARY_SENT: "ITINERARY_SENT",
  HUMAN_TRANSFER_REQUESTED: "HUMAN_TRANSFER_REQUESTED",
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Business constants */
export const HOLD_DURATION_MINUTES = 10;
export const MAX_OPTIONS_PRESENTED = 3;
export const MAX_VERIFICATION_ATTEMPTS = 2;
