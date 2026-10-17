# SkyFlow Assist

An airline disruption assistant that helps passengers rebook cancelled flights. All airline, passenger, and booking data is fictional. Booking eligibility, inventory, and confirmation are controlled by deterministic backend rules.

The current implementation is a Next.js text simulator with an OpenAI provider and scripted offline walkthroughs. ElevenLabs browser voice and a full employee takeover dashboard are the next milestones.

## Run the local demo

Use Node.js 20.9 or newer.

```bash
npm ci
npm run setup:demo
npm run dev
```

Open [the simulator](http://localhost:3000/simulator) or [the disruption board](http://localhost:3000).

`setup:demo` creates an ignored local `.env`, generates a tool access key, applies database migrations, and seeds an empty demo database with tomorrow's flights. It preserves existing application data on later runs. It only supports the local `file:./dev.db` database.

The new local environment uses `TEXT_AGENT_PROVIDER=fake` and enables development-only demo resets. Interactive fake-provider replies are canned; use the three **scripted scenario** buttons to see complete backend workflows. The scenarios explicitly restore the fictional data before running and make no AI API calls.

## Try the passenger journeys

| Scenario | Booking / surname | Outcome |
|---|---|---|
| Successful rebooking | `SKY82Q` / Martin | Search eligible flights, hold SF218, read it back, then rebook after an explicit yes |
| No flights available | `SKY55T` / Okafor | Create a support case for human assistance |
| Failed verification | `SKY82Q` / Dubois | Refuse booking disclosure and escalate after two failed checks |

The simulator displays the conversation, tool calls, state transitions, active-hold status, and audit events. Scripted replies demonstrate orchestration and backend safeguards; they do not measure a live model's reliability.

Each scripted run and **Reset demo** replaces fictional demo records and clears simulator conversations. These endpoints require both `NODE_ENV=development` and `ALLOW_DEMO_RESET=true`. Flights are seeded for tomorrow; reset the demo when its saved timetable becomes stale.

## Use a live text model

Set these values in your local `.env`, then restart the development server:

```dotenv
TEXT_AGENT_PROVIDER="openai"
OPENAI_API_KEY="your-key-here"
```

`TEXT_AGENT_MODEL` and `TEXT_AGENT_REASONING_EFFORT` select the passenger assistant's model. They are independent of the model used to develop this repository. Model access and live API usage depend on your account. Keep keys server-side and out of Git.

## Validation

```bash
npm test
npm run lint
npm run build
```

There are 123 automated tests covering domain rules, service transactions, authenticated HTTP tools, hold cancellation, conversation orchestration, and the scripted scenarios. Tests apply the real migrations to a fresh temporary SQLite database and remove it afterward. They never reset the development database and never make live AI API calls.

The app uses system fonts, so production builds do not require a Google Fonts download.

## Implementation status

| Milestone | Status |
|---|---|
| Data model and deterministic rebooking rules | Implemented |
| Transactional services, inventory, holds, and idempotency | Implemented |
| Authenticated webhook tool routes | Implemented |
| Text simulator, agent tool loop, and scripted scenarios | Implemented |
| Browser voice through ElevenLabs | Pending agent setup and integration |
| Employee monitoring, persistent transcripts, and takeover | Pending; the current inspector is a developer tool |
| Live-model quality evaluation | Pending; existing conversation tests use scripted model responses |
| Hosted deployment | Pending; needs durable storage, session handling, and access controls |
| Telephone channel | Optional later milestone |

The current simulator keeps model conversation context in the server process. It expires when that process restarts. The database persists bookings, holds, support cases, sessions, and audit events. A support case is an escalation record, not a connection to a staffed contact centre.

## Code map

- `src/domain/`: eligibility, verification, and booking-state rules.
- `src/server/services/` and `repositories/`: database-backed airline operations.
- `src/app/api/tools/`: authenticated airline tools.
- `src/agent/`: model instructions, tool execution, and the conversation loop.
- `src/app/simulator/` and `src/app/api/simulator/`: text UI and offline walkthroughs.
- `prisma/`: schema, migrations, and fictional seed data.
- `tests/`: automated checks and isolated database setup.
- [Voice setup](docs/voice-setup.md) and [webhook map](docs/elevenlabs-tools.md): credentials and intended voice-tool configuration.

Real airline/GDS APIs, real passenger records, payments, refunds, compensation, loyalty, outbound email, and telephony are outside the current demo scope.
