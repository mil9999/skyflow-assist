# SkyFlow Assist

An airline disruption assistant that helps passengers rebook cancelled flights. All airline, passenger, and booking data is fictional. Booking eligibility, inventory, and confirmation are controlled by deterministic backend rules.

The current implementation includes a Next.js text simulator, scripted offline walkthroughs, an ElevenLabs browser conversation page, and a local employee workspace for monitoring and takeover by text.

## Run the local demo

Use Node.js 20.9 or newer.

```bash
npm ci
npm run setup:demo
npm run dev
```

Open [the simulator](http://localhost:3000/simulator), [the disruption board](http://localhost:3000), or [the employee workspace](http://localhost:3000/employee).

`setup:demo` creates an ignored local `.env`, generates a tool access key, applies database migrations, and seeds an empty demo database with tomorrow's flights. It preserves existing application data on later runs. It only supports the local `file:./dev.db` database.

After pulling changes with a database migration, run `npm run setup:demo` again and restart the development server. Existing fictional bookings are preserved.

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

## Use the ElevenLabs agent

Add `ELEVENLABS_API_KEY` to the ignored local `.env`. To create a dedicated SkyFlow agent and its seven client tools in your ElevenLabs account:

```bash
npm run setup:voice -- --create
npm run dev -- --hostname 127.0.0.1
```

The setup script saves the agent ID locally and enables signed-URL authentication. If setup is interrupted, it resumes using an ignored local configuration checkpoint. It refuses to overwrite a different configured agent. See [voice setup](docs/voice-setup.md) for details.

Open [voice rebooking](http://127.0.0.1:3000/voice). Choose a microphone conversation or **Use text instead of microphone**, then start. Both modes use the live ElevenLabs agent and account credits. The permanent key stays on the server. Browser client tools call the same deterministic airline backend used by the text simulator.

The voice endpoints require development mode and a loopback host, and reject foreign browser origins. They remain disabled in production until application authentication and deployment controls are implemented.

## Monitor and take over a conversation

Open `/employee` in a second browser tab on the same local origin. Select a passenger to see saved messages, booking state, support cases, and audit activity. **Take over** blocks subsequent AI booking actions and opens a shared text conversation with the passenger. A voice session disconnects its AI transport when takeover is detected; employee assistance continues by text.

Employees use the same backend identity, eligibility, inventory, and confirmation rules. Verify an unverified passenger before loading their booking. Read back the held flight and obtain an explicit yes before checking the confirmation box. Approval is tied to that exact hold; a replacement hold requires fresh confirmation. See [the employee walkthrough](docs/employee-workflow.md).

The workspace, shared transcript routes, and voice bridge are restricted to loopback development hosts and reject foreign browser origins. Employee login and hosted access controls are still required before deployment.

## Recover abandoned seat holds

If a browser or server stops before releasing a held seat, run this from the repository root:

```bash
npm run holds:expire
```

The command loads the local environment and checks persisted hold deadlines. It releases overdue active holds, restores their seats, and returns linked conversations to the flight options. Future, cancelled, and confirmed holds are left alone. Repeating the command is safe; its JSON result reports only newly expired holds, for example `{"expiredHolds":1}`.

The development server also sweeps overdue holds at startup and every 30 seconds, including holds controlled by an employee. This worker runs only while the local development server is running; it is disabled in production. The command remains available for manual recovery. Hosted deployment still needs a scheduled worker.

## Validation

```bash
npm test
npm run lint
npm run build
```

There are 197 automated tests covering domain rules, transactional rebooking, authenticated tools, hold cancellation and expiry, persistent text and voice context, employee takeover, shared messages, and scripted scenarios. Recovery checks use separate Node processes. Tests apply the real migrations to a fresh temporary SQLite database and remove it afterward. They never reset the development database and never make live AI API calls.

Run `npm run eval:voice -- --offline` to rehearse the evaluation harness without AI calls. Opt into billable ElevenLabs checks with `npm run eval:voice -- --live --scenario rebooking --runs 1` (Node.js 22+). Every evaluation gets a disposable migrated database. The evaluator covers rebooking after an ambiguous answer, no alternatives, failed identity verification, expired-hold recovery, employee takeover, varied unclear approval, and declining a held flight. Reports capture the configured agent and reject configuration drift. The latest 14-case live batch recorded six passes and eight inconclusive connection failures; an isolated cancellation retry was also inconclusive. Repeated reliability and that new cancellation case remain unverified. See [evaluation commands, results, and limits](docs/voice-evaluation.md).

The app uses system fonts, so production builds do not require a Google Fonts download.

If the local environment prevents Turbopack's CSS worker from binding its internal port (`Operation not permitted`), use the supported alternative `npm run build -- --webpack`. The default build command still uses Turbopack.

## Implementation status

| Milestone | Status |
|---|---|
| Data model and deterministic rebooking rules | Implemented |
| Transactional services, inventory, holds, and idempotency | Implemented |
| Authenticated webhook tool routes | Implemented |
| Text simulator, agent tool loop, and scripted scenarios | Implemented |
| Browser voice through ElevenLabs | Local integration implemented; live agent tested through text mode; spoken audio check pending |
| Persistent text context and transcript | Implemented for completed turns; interrupted turns require a new conversation |
| Persistent voice tool context and transcript | Implemented; completed calls survive backend restarts, remote call resumption after page reload remains pending |
| Employee monitoring and takeover | Local demo implemented; shared text assistance and backend ownership checks |
| Local automatic hold expiry | Development startup sweep and 30-second worker implemented; hosted scheduling pending |
| Live-model quality evaluation | Seven-scenario harness with configuration capture implemented; repeated live validation and spoken evaluation tracked separately |
| Hosted deployment | Pending; needs durable storage, session handling, and access controls |
| Telephone channel | Optional later milestone |

The simulator saves completed turns in SQLite, including model history, the transcript, option mappings, and confirmation context. It restores the current conversation ID from browser session storage after a page reload. Overlapping or stale requests receive HTTP 409 before a model or tool call. A turn interrupted before its checkpoint remains locked: start a new conversation or use employee takeover to assist by text. Overdue seats are recovered by the local worker or `holds:expire`. Demo reset deletes saved conversations along with the fictional sessions.

The database also persists bookings, holds, support cases, sessions, and audit events. Stored conversations include fictional passenger details and remain in the ignored local database. A support case queues local employee review; it does not automatically connect a staffed contact centre.

Voice option mappings, confirmation context, completed tool responses, and closed state are saved in SQLite. Shared transcript messages are saved as the browser receives them. An existing browser connection can continue backend operations after a server restart; reloading the page starts a new ElevenLabs connection. Restoring the remote conversation is not implemented. An interrupted tool remains locked to avoid replaying a possibly committed operation. Normal AI disconnect, declining a held flight, and support escalation release unconfirmed holds. An employee-owned hold survives AI disconnect and still expires at its deadline. Page-leave cleanup and transcript delivery are best effort.

## Code map

- `src/domain/`: eligibility, verification, and booking-state rules.
- `src/server/services/` and `repositories/`: database-backed airline operations.
- `src/app/api/tools/`: authenticated airline tools.
- `src/agent/`: model instructions, tool execution, and the conversation loop.
- `src/app/simulator/` and `src/app/api/simulator/`: text UI and offline walkthroughs.
- `src/app/employee/`, `src/server/employee/`, and `src/components/passenger-thread.tsx`: monitoring, takeover, and shared text assistance.
- `src/server/voice/` and `src/server/conversations/`: persistent voice tools and safe passenger transcript views.
- `prisma/`: schema, migrations, and fictional seed data.
- `tests/`: automated checks and isolated database setup.
- `src/evaluation/` and `scripts/evaluate-voice*`: opt-in live voice checks and offline harness rehearsals.
- [Voice setup](docs/voice-setup.md) and [webhook map](docs/elevenlabs-tools.md): credentials and intended voice-tool configuration.

Real airline/GDS APIs, real passenger records, payments, refunds, compensation, loyalty, outbound email, and telephony are outside the current demo scope.
