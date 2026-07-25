# SkyFlow Assist — AI Airline Disruption Agent

A voice agent that helps passengers rebook after a flight cancellation.
Fictional airline, fictional passengers, simulated rebooking.

- **Voice layer (later):** ElevenLabs Agents
- **Brains and rules (this repo):** Next.js + Prisma + SQLite

## Phase 1 — what exists now

In scope:

- Verification by booking reference + surname
- Cancelled-flight detection
- Alternative-flight search with direct-only and latest-arrival preferences
- Seat hold with expiry
- Rebooking only after an active hold **and** explicit passenger confirmation
- Human escalation from any state
- Audit trail

Not in scope yet: real airline/GDS APIs, real passenger data, passports, payments, refunds,
compensation, loyalty points, real email, telephony.

## Key files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Passengers, flights, bookings, disruptions, holds, sessions, audit events |
| `prisma/seed.ts` | SkyFlow Airlines fixtures — three demo scenarios plus decoy flights |
| `src/domain/constants.ts` | Status/state values and business constants |
| `src/domain/rebooking.ts` | Pure, deterministic rules — no DB, no LLM |
| `tests/rebooking.test.ts` | 23 Vitest cases covering the Phase 1 checklist |

## Commands

```bash
npm install @prisma/client zod            # one time
npm install --save-dev prisma vitest tsx  # one time

npx prisma migrate dev --name initial_schema   # create the database
npx prisma generate                            # generate the DB client
npm run seed                                   # load fictional data
npm test                                       # expect 23 passing
npm run studio                                 # browse the data
npm run dev                                    # http://localhost:3000
```

## Seeded scenarios

| Scenario | Reference | Surname | Expected agent behaviour |
|---|---|---|---|
| A — happy path | `SKY82Q` | Martin | SF204 cancelled → offer SF218 (15:15), SF310 (18:40, 1 stop), SF224 (19:45) → hold → confirm → rebooked |
| B — no options | `SKY55T` | Okafor | SF640 cancelled, alternatives full or cancelled → escalate to a human |
| C — bad identity | `SKY82Q` | Dubois | `SURNAME_MISMATCH`; reveal nothing about the booking |

Decoys that must never be offered: SF228 (0 seats), SF644 (full), SF648 (cancelled),
SF120 (wrong destination), SF900 (already departed).

## Design rule

The LLM chooses *which* tool to call and *how to speak*. It never decides eligibility, price,
seat availability, or whether a rebooking may proceed. Those answers come only from
`src/domain/rebooking.ts` via the backend.

## Roadmap

1. **Phase 1 ✅** Data model + deterministic rules + tests
2. **Phase 2** Service layer: `verifyPassenger`, `getRebookingOptions`, `holdFlight`, `confirmRebooking`, `escalateToHuman`
3. **Phase 3** API routes (these become ElevenLabs webhook tools)
4. **Phase 4** Text-mode conversation testing (free)
5. **Phase 5** ElevenLabs voice in the browser
6. **Phase 6** Employee dashboard: live transcript, booking state, tool calls, takeover button
7. **Phase 7** Guardrails, audit log, scripted evaluations
8. **Phase 8** Deploy to Vercel
9. **Phase 9** Optional: Twilio phone number
