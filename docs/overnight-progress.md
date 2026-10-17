# SkyFlow Assist development checkpoint

Updated: 17 October 2026. Repository: `mil9999/skyflow-assist` (public). Current work branch: `codex/complete-disruption-demo`.

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
- Final validation: all 138 tests, lint, TypeScript, and the production build pass, including the final state-signal adjustment. The dedicated remote agent's instructions and authentication were synchronized and verified. Demo bookings were restored after live testing.
- Updated Next.js to 16.4.2 and compatible locked dependencies. `npm audit` now reports 8 high advisories in the braces lint-tool chain and the Prisma/deepmerge-ts configuration chain; the production-filtered audit includes the 3 Prisma-chain entries. Resolve these deliberately before deployment rather than forcing a framework downgrade or an unplanned Prisma major migration.

## Next work

1. Validate microphone speech recognition, audio, interruptions, and live expired-hold recovery. The live agent's rebooking tools have been exercised through text mode. See `voice-setup.md`; do not print credentials or commit `.env`.
2. Add repeatable live-model evaluation across the passenger journeys; individual successful live runs do not establish reliability.
3. Add persistent conversation context and an employee monitoring/takeover interface.
4. Prepare hosted storage, session handling, and access controls before deployment.

The current text and voice backends keep conversation context in memory. The voice transcript lives in the browser. Support cases are records, not a live contact-centre connection. Durable expiry/crash recovery and application authentication are required before hosted voice is enabled.

Work is tracked in draft [PR #1](https://github.com/mil9999/skyflow-assist/pull/1). Keep it reviewable and update its description when scope changes.

Scheduled work continues in this chat from 00:00 to 05:00 Europe/Paris and inherits its model settings. Save meaningful progress here; notify only on milestones, failures, or required user action. Do not merge or deploy automatically.
