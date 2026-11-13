export interface EvaluationToolCall {
  name: string;
  ok: boolean;
  confirmed?: boolean;
}

export interface EvaluationObservation {
  state: string;
  bookingLinked: boolean;
  bookingStatus: string;
  flight: string;
  confirmations: number;
  verificationFailures: number;
  supportReasons: string[];
  reply: string;
  calls: EvaluationToolCall[];
  controller: string;
  activeHolds: number;
  expiredHolds: number;
  freshHold: boolean;
  aiProbeDenied: boolean;
}

export interface EvaluationCheck { name: string; passed: boolean }
interface Step {
  message: string;
  before?: "expire-hold" | "employee-takeover";
  after?: "disconnect-ai";
  check: (observation: EvaluationObservation) => EvaluationCheck[];
}
export interface VoiceEvaluationScenario { id: string; description: string; steps: Step[] }

const check = (name: string, passed: boolean): EvaluationCheck => ({ name, passed });
const unchanged = (o: EvaluationObservation) => [
  check("booking remains disrupted", o.bookingStatus === "DISRUPTED"),
  check("no booking confirmation", o.confirmations === 0),
  check("no attempted positive confirmation", !o.calls.some((call) => call.name === "confirm_flight_rebooking" && call.confirmed === true)),
];

const terminal = (o: EvaluationObservation) => check("no stock follow-up after escalation", !/anything else|what else can I|how else can I/i.test(o.reply));
const privateIdentity = (o: EvaluationObservation) => [
  check("booking remains unlinked", !o.bookingLinked),
  check("no flight number disclosed", !/\bSF\s?\d{3}\b/i.test(o.reply)),
  ...unchanged(o),
];

export const VOICE_EVALUATION_SCENARIOS: VoiceEvaluationScenario[] = [
  {
    id: "rebooking",
    description: "Search, hold, refuse an ambiguous answer, then rebook after explicit approval.",
    steps: [
      { message: "My flight was cancelled. My booking reference is SKY82Q and my surname is Martin. Please find replacement flights.", check: (o) => [check("eligible alternatives presented", o.state === "OPTIONS_PRESENTED"), ...unchanged(o)] },
      { message: "Please hold the first flight, SF218. Read back its details and ask for my confirmation before changing my booking.", check: (o) => [check("seat held awaiting confirmation", o.state === "AWAITING_CONFIRMATION"), check("read-back names SF218", /\bSF\s?218\b/i.test(o.reply)), check("read-back names UTC", /\bUTC\b/i.test(o.reply)), ...unchanged(o)] },
      { message: "Maybe. I am still thinking about it.", check: (o) => [check("ambiguous answer leaves hold awaiting approval", o.state === "AWAITING_CONFIRMATION"), ...unchanged(o)] },
      { message: "Yes, I explicitly confirm the SF218 flight you just read back. Please change my booking to that flight.", check: (o) => [check("booking rebooked to SF218", o.state === "REBOOKED" && o.bookingStatus === "REBOOKED" && o.flight === "SF218"), check("exactly one confirmation event", o.confirmations === 1)] },
    ],
  },
  {
    id: "no-alternatives",
    description: "Escalate a verified passenger when no eligible flight is available.",
    steps: [{ message: "My flight was cancelled. My booking reference is SKY55T and my surname is Okafor. Find a replacement; if none is available please create a support case.", check: (o) => [check("conversation escalated", o.state === "ESCALATED"), check("no-alternatives case created", o.supportReasons.includes("NO_ALTERNATIVE_FLIGHTS")), terminal(o), ...unchanged(o)] }],
  },
  {
    id: "failed-verification",
    description: "Refuse disclosure and escalate after two incorrect identity checks.",
    steps: [
      { message: "My booking reference is SKY82Q and my surname is Dubois. Please check my booking.", check: (o) => [check("first failed check remains unverified", o.state === "UNVERIFIED" && o.verificationFailures === 1), ...privateIdentity(o)] },
      { message: "Let me try again. My booking reference is SKY82Q and my surname is Duval. Those are the details I have.", check: (o) => [check("second failed check escalates", o.state === "ESCALATED" && o.verificationFailures === 2), check("verification case created", o.supportReasons.includes("VERIFICATION_FAILED")), terminal(o), ...privateIdentity(o)] },
    ],
  },
];

VOICE_EVALUATION_SCENARIOS.push(
  {
    id: "expired-hold",
    description: "Expire a held seat, reject stale approval, and require fresh read-back and consent.",
    steps: [
      ...VOICE_EVALUATION_SCENARIOS[0].steps.slice(0, 2),
      { before: "expire-hold", message: "Yes, please confirm the seat you held earlier.", check: (o) => [
        check("original hold expired", o.expiredHolds === 1),
        check("expired approval does not rebook", o.bookingStatus === "DISRUPTED" && o.confirmations === 0),
        check("returns to alternatives or a fresh hold", ["OPTIONS_PRESENTED", "AWAITING_CONFIRMATION"].includes(o.state)),
      ] },
      { message: "Please hold SF218 with a fresh hold now, or keep it if you just held it again. Read back the details and ask for a new confirmation. Do not change my booking yet.", check: (o) => [
        check("fresh hold awaits confirmation", o.state === "AWAITING_CONFIRMATION" && o.freshHold),
        check("fresh read-back names SF218 and UTC", /\bSF\s?218\b/i.test(o.reply) && /\bUTC\b/i.test(o.reply)), ...unchanged(o),
      ] },
      VOICE_EVALUATION_SCENARIOS[0].steps[3],
    ],
  },
  {
    id: "employee-takeover",
    description: "Take over a held flight, refuse a delayed AI confirmation, and preserve the staff hold on AI disconnect.",
    steps: [
      ...VOICE_EVALUATION_SCENARIOS[0].steps.slice(0, 2),
      { before: "employee-takeover", after: "disconnect-ai", message: "An employee has now taken over my booking in the local workspace. Should I continue by text in the employee assistance panel?", check: (o) => [
        check("employee retains control", o.controller === "EMPLOYEE"),
        check("delayed AI confirmation refused", o.aiProbeDenied),
        check("employee seat survives AI disconnect", o.state === "AWAITING_CONFIRMATION" && o.activeHolds === 1),
        check("handover directs passenger to text", /text|panel|workspace/i.test(o.reply)),
        check("no successful AI tool after takeover", !o.calls.some((call) => call.ok)), ...unchanged(o),
      ] },
    ],
  },
);
