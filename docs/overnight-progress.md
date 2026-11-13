# SkyFlow Assist development checkpoint

Updated: 13 November 2026 (Europe/Paris overnight window). Repository: `mil9999/skyflow-assist` (public). Current work branch: `codex/complete-disruption-demo`.

## Completed in the current milestone

- Restored a runnable local checkout with a separate ignored `.env` and fictional demo database.
- Added `npm run setup:demo` to apply migrations and seed an empty local database, while preserving existing application data on later runs.
- Fixed lint errors in the tool executor and removed external font downloads from production builds.
- Isolated tests in a fresh temporary database populated by the actual migrations.
- Added visibly scripted simulator walkthroughs for successful rebooking, no available flights, and two failed identity checks. These exercise the real backend without calling AI APIs.
- Browser-checked all three journeys and updated the README to distinguish implemented capabilities from pending work.
- Created a dedicated ElevenLabs **SkyFlow Assist** agent with seven blocking client tools and signed-URL authentication. The key and agent ID are saved only in the ignored local `.env`; the setup script can resume and synchronize the dedicated agent's instructions.
- Added `/voice` with microphone controls, a live text alternative, transcript, booking state, and tool activity. Voice endpoints are restricted to loopback development origins; session IDs, hold IDs, flight IDs, and confirmation idempotency keys stay on the server.
- Added serialized tool execution, transport retry deduplication, and normal-disconnect hold release. Escalation now releases a held seat before making the conversation terminal.
- Live ElevenLabs text-mode checks passed: no available flights and support case, direct search, hold/read-back, ambiguous confirmation refusal, declined hold release, replacement selection, explicit confirmation, final rebooking, and escalation after two failed identity checks without booking disclosure. SQLite showed SF224 booked once, SF218 restored to 17 seats, SF224 at 3 seats, and zero active holds. The agent's unsupported follow-up promise was removed from its instructions.
- Added explicit backend state to voice tool results after observing a redundant handover request following automatic verification escalation. Terminal states now tell the model to stop calling tools; the backend already refused that extra request.
- Voice milestone validation (17 October): all 138 tests, lint, TypeScript, and the production build passed, including the final state-signal adjustment. The dedicated remote agent's instructions and authentication were synchronized and verified. Demo bookings were restored after live testing.
- Updated Next.js to 16.4.2 and compatible locked dependencies. The last dependency audit (17 October) reported 8 high advisories in the braces lint-tool chain and the Prisma/deepmerge-ts configuration chain; the production-filtered audit included the 3 Prisma-chain entries. Resolve these deliberately before deployment rather than forcing a framework downgrade or an unplanned Prisma major migration.

## Hold-expiry recovery milestone (5 November)

- Added a one-shot `npm run holds:expire` command using persisted hold deadlines without browser or model context.
- Expiry ignores future deadlines and already released/confirmed holds; repeated sweeps report only newly released seats.
- Added regression coverage for early/repeated expiry, cancelled/confirmed holds, overlapping workers, and a separate recovery process.
- Updated README and voice setup with recovery instructions and the distinction between a one-shot command and a scheduled worker. No scheduler was installed.
- Validation: all 143 tests pass against a temporary migrated database; lint and `tsc --noEmit` pass. The separate-process test exercises the recovery command twice without browser or model memory and confirms inventory is restored once.
- Production verification: `npm run build -- --webpack` passes, including TypeScript and all 21 generated pages. The default Turbopack build remains blocked by the local environment denying the CSS worker's internal port, including on the requested escalation; no successful default build is claimed for this milestone.
- Duplicate generated `.next/types` files had caused TypeScript collisions. Moved only those duplicate cache files to a temporary backup; source TypeScript checks were not weakened.

## Employee takeover and persisted voice milestone (13 November)

- Implemented `/employee`: saved conversation queue, shared transcript, support cases, audit history, identity checks, flight search, seat holds, release, and confirmed rebooking. Passenger and staff exchange text without invoking an AI model. Employee assistance during a voice handover continues by text; no employee voice call is claimed.
- Takeover persists employee ownership and blocks subsequent AI booking tools, including authenticated webhook calls and cached voice calls. An in-flight text reply is suppressed after takeover while preserving the passenger's message. Existing holds remain available to staff and still expire. Escalated cases reopen an audited review stage without bypassing identity verification.
- Added SQLite voice context, closed/busy state, version guards, and completed tool-call responses. Separate Node processes restore options and a hold, confirm once, and replay completed responses without another booking change. Interrupted operations fail closed; automatic mid-operation recovery and remote ElevenLabs connection resumption after page reload are not implemented.
- Added a shared stored transcript with message retry deduplication, speaker validation, passenger-safe views, and backfill from older text checkpoints on takeover. The simulator restores its conversation ID from tab session storage after reload. Voice transcript delivery on page leave remains best effort.
- Added development-only hold recovery at startup and every 30 seconds. The worker covers employee-owned holds and runs only while the development server is alive. Production scheduling remains pending; `holds:expire` remains available manually.
- Final review bound employee approval to the exact hold. A replacement created in another window cannot reuse earlier consent. A delayed cancellation retry cannot rewind or erase a newer hold. Direct webhook escalation releases a seat atomically.
- New employee, transcript, and voice routes require a loopback development host and reject foreign origins. They remain disabled in production until login and hosted access controls exist.
- Validation: **165 tests in 14 files pass**, including the added ownership, persistence, stale approval, cancellation retry, and old-history regressions. Lint and `tsc --noEmit` pass. `npm run build -- --webpack` passes with all 24 generated pages. The previously documented Turbopack environment restriction remains; no new default-build success is claimed. Existing Vite configuration and Prisma configuration deprecation notices remain non-failing.
- Browser acceptance on an isolated fictional database (13 November): employee takeover, identity verification, booking load, eligible alternatives, held-flight read-back, passenger explicit yes, confirmation enabled only after staff acknowledgment, one SF218 rebooking to seat 26E, bidirectional final message, and simulator reload recovery all passed. The development database was not reset. Evidence is saved outside Git at `/private/tmp/skyflow-employee-milestone.jpg`.
- Earlier live ElevenLabs text-mode acceptance (9 November): no alternatives created a support case visible in the employee queue; takeover disconnected the AI transport and delivered an employee text reply. The live model still offered an unrelated follow-up after escalation. On 13 November, terminal-stop, expired-hold consent, and text-handover instructions were synchronized to the dedicated agent and all seven tools verified. The subsequent evaluation milestone below records fresh live text-mode checks of the updated terminal behavior.
- Applied the additive local migration after an SQLite backup. Counts of every pre-existing application table were unchanged (5 passengers, 10 flights, 5 bookings, 2 disruptions, 1 session, 1 audit event; existing holds/cases/idempotency/text checkpoints empty). The backup is outside Git. Existing local flight dates were preserved; use the simulator's explicit reset or scripted scenario buttons to refresh fictional dates when desired.
- Updated README, voice setup, and the employee walkthrough to reflect actual behavior and remaining limits. No credentials, local databases, screenshots, or account setup checkpoints belong in the public repository.

## Repeatable live evaluation milestone (13 November)

- Added `npm run eval:voice` with explicit `--offline` and `--live` modes, scenario selection, and 1–5 repetitions. No mode prints usage without connecting. Live mode uses the official ElevenLabs client SDK in text-only mode, the existing dedicated agent, and the same local voice tool bridge; it requires Node.js 22+ and consumes account credits. The SDK was already installed transitively and is now a direct dependency.
- Each run uses a fresh migrated temporary database and fictional flights. The worker validates its disposable location and marker before importing Prisma, refuses database symlinks, closes the conversation, and removes its temporary records. The saved demo database is untouched.
- The evaluator checks persisted state, audit counts, attempted tool calls, and narrow reply patterns. It stops on the first failed check. Safe JSON reports omit credentials, signed URLs, airline IDs, and full transcripts. Network/provider/timeouts are inconclusive rather than successful model checks.
- Offline fixtures pass all three scenarios. Seven new tests cover those rehearsals, deliberate premature confirmation after “maybe,” explicit mode selection, saved-database refusal, and symlink refusal. The final full suite passes **172 tests in 15 files**; lint and TypeScript pass, and the production Webpack build passes with all 24 generated pages.
- Initial actual live samples: **rebooking passed** (4 steps, 16.229 s), **no alternatives passed** (1 step, 8.031 s), and **failed verification passed** (2 steps, 9.466 s). Rebooking left the hold unchanged after “maybe,” then recorded exactly one confirmation after explicit yes. Both escalation samples avoided the stock follow-up previously observed. A sandbox connection attempt was inconclusive before approved network execution; it was not counted as a model sample.
- Documented commands, scope and limitations in `docs/voice-evaluation.md`; the sanitized sample summary is in `docs/evaluations/2026-11-13.json`. Remote model settings are not pinned/captured, response completion uses a two-second quiet interval after a post-tool reply, and reply-pattern checks do not establish complete semantic or privacy correctness. Three single samples are not a reliability estimate.

## Next concrete work

1. Extend the evaluator to live expired-hold recovery and employee takeover, then broaden ambiguous/declined approval phrasing and repeat a fixed matrix with captured agent/model configuration. The current local environment has ElevenLabs credentials but no OpenAI text-model key; do not expose either.
2. Validate microphone speech recognition, audio, interruptions, and spoken rebooking with the user. Microphone permission for the local voice page is still pending; no spoken acceptance is claimed. The terminal-stop prompt now has fresh passing live text-mode samples; expired-hold and takeover behavior still need live evaluator coverage.
3. Prepare employee login, passenger access controls, hosted storage and session handling, a production expiry scheduler, and dependency advisory remediation before any deployment. Real airline APIs, payments, refunds, compensation, and telephony remain outside the current demonstration.

## Persistent text conversation milestone (5 November)

- Added an additive migration for server-only text conversation checkpoints linked to airline sessions. Completed turns store model input/output history, the transcript, option mappings including price, and confirmation context.
- Conversation lookup now reads from SQLite. An open simulator can continue after a server restart using its existing conversation ID. Reloading the browser page still creates a new conversation; no history browser or employee dashboard has been added yet.
- Added a database-backed turn lock and optimistic version check before model/tool execution. Concurrent and stale requests return HTTP 409. If a process stops mid-turn, the lock stays set and the conversation cannot replay possibly committed tools; start a new conversation and sweep overdue holds. Automatic mid-turn recovery is outside this checkpoint.
- Restored contexts read the authoritative backend hold state so an expiry sweep cannot resurrect a held seat. Confirmation now clears the session's active-hold navigation pointer in the same booking transaction. Confirmed inventory remains reserved for the booking.
- Demo session deletion cascades to stored text checkpoints, keeping resets from reviving prior history. Only fictional local data is used; no model API calls are made by automated checks.
- Validation: all 149 tests pass, including recovery and confirmation in a separate Node process, overlapping/stale turn refusal, interrupted-process HTTP conflicts, external expiry, handled configuration errors, and reset deletion. Lint and TypeScript pass; `npm run build -- --webpack` passes. The default Turbopack environment restriction described above remains.
- Applied the additive migration to the local demo with `setup:demo` after taking a temporary database backup. All pre-existing application table row counts were unchanged; fictional bookings were not reset. Restart the development server to load the regenerated Prisma client.

The 5 November limitations above are historical. The 13 November milestone adds persisted voice tools, shared transcripts, local employee takeover, page reload recovery for text, and a development expiry worker. Authentication, hosted scheduling, and remote voice connection resumption remain pending.

Work is tracked in draft [PR #1](https://github.com/mil9999/skyflow-assist/pull/1). Keep it reviewable and update its description when scope changes.

Scheduled work continues in this chat from 00:00 to 05:00 Europe/Paris and inherits its model settings. Save meaningful progress here; notify only on milestones, failures, or required user action. Do not merge or deploy automatically.
