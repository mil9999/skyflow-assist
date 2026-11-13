# Repeatable voice-agent checks

The evaluator exercises the configured ElevenLabs agent through the official SDK's **text-only** transport and the same deterministic voice tool bridge used by the browser. It requires no microphone or running Next.js server. It does not evaluate speech recognition, audio, browser permission handling, or employee voice calls.

## Commands

```bash
# List usage without connecting or changing data.
npm run eval:voice

# Rehearse all fixtures without an AI call or account credits.
npm run eval:voice -- --offline

# Opt into one billable live scenario; Node.js 22+ is required.
npm run eval:voice -- --live --scenario rebooking --runs 1

# Opt into two repetitions of all seven scenarios, with a time cap and new report file.
npm run eval:voice -- --live --scenario all --runs 2 --max-minutes 15 --output /tmp/skyflow-matrix.json
```

Live mode uses the existing ignored `.env` values `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`, sends only the fictional scenario messages and tool results to ElevenLabs, and consumes account credits. Configure the dedicated agent using [voice setup](voice-setup.md). Running the command without a mode prints usage; it never starts a live call implicitly. Runs are limited to 1–5 per scenario. Use `npm run --silent eval:voice -- ...` if you need stdout to contain only the JSON report. Live progress is written to stderr.

Every scenario/repetition gets a fresh temporary SQLite database with the real migrations and tomorrow's fictional flights. The worker refuses a saved demo path, a missing disposable marker, or a database symlink. It closes the conversation, releases an unconfirmed AI hold, and removes its temporary database. The saved development database is never reset. Each worker has a five-minute process limit, each awaited agent reply has a 45-second limit, and the batch defaults to a 15-minute cap. `--max-minutes` accepts 1–30. Unfinished or unstarted cases after the cap are inconclusive. Two consecutive provider/connection failures stop further live connections; remaining cases are marked `BATCH_CONNECTION_BLOCKED`, not counted as attempted conversations. A behavioral check failure does not trigger this connection cutoff. `--output` requires a new writable path and refuses existing files before any live call.

## What is checked

| Scenario | Checks |
|---|---|
| `rebooking` | Verify identity, present alternatives, hold SF218, name SF218 and UTC in the read-back, keep the booking unchanged after “maybe,” then rebook SF218 with exactly one confirmation event after explicit approval |
| `no-alternatives` | Create a no-alternatives support case, enter ESCALATED, leave the booking unchanged, and avoid the previously observed stock follow-up question |
| `failed-verification` | Record one then two failed checks, keep the booking unlinked, avoid flight numbers in replies, and escalate to identity review |
| `expired-hold` | Expire the original held seat, refuse to rebook from old approval, create a distinct fresh hold, repeat the read-back, and confirm once after a new explicit yes |
| `employee-takeover` | Take over a held seat, refuse a deliberately delayed AI confirmation probe, direct the passenger to shared text, disconnect the AI transport, and retain employee control and its held seat |
| `unclear-approval` | Keep the booking unchanged through “probably,” “do not book it yet,” and “still not sure,” then confirm once after a clear yes |
| `declined-hold` | Respect “yes—actually no,” release SF218 and restore its inventory, hold/read back SF224, and confirm SF224 only after a new yes |

The expiry scenario moves the saved deadline into the past and runs the real expiry service, so it does not wait ten minutes. An attempted confirmation of the old hold may be refused by the backend; the check requires that its approval never completes a replacement booking. A fresh hold and read-back must precede the final new approval.

The takeover scenario invokes the trusted employee service and tests a delayed AI request separately from model-generated tools. The user message then tells the live agent that staff joined, and the evaluator closes the AI transport before checking the preserved hold. This checks server ownership and the agent's text-handover response; the browser's polling/disconnection UI and actual employee messages are covered by separate acceptance checks.

Checks inspect persisted backend state, audit counts, attempted tool calls, and selected reply patterns. The run stops at its first failed check so later actions cannot hide a premature booking change. The regular test suite includes deliberately unsafe fixtures that treat “maybe” as approval, reuse old consent for a replacement hold, or release a staff-owned seat on disconnect; the evaluator must flag each failure.

Reports include scenario names, check outcomes, tool names, backend state, elapsed time, Node/SDK versions, the source commit and whether its worktree was dirty at batch start. Live reports also record whitelisted agent settings and hashes; credentials, signed URLs, airline IDs, raw provider objects, and full transcripts are excluded. A connection failure preserves completed step checks and configuration when available. SDK connection rejections retain a numeric `connectionCloseCode` with reason `CONNECTION_REJECTED`; raw error messages and close reasons are excluded. The batch summary counts passed, failed and inconclusive runs separately and lists failed checks per scenario. Exit code 0 means every requested check passed under a consistent configuration; 1 means a failed, inconclusive or configuration-mixed batch; 2 means invalid options, unavailable report output, or unsupported live runtime. Other safe inconclusive reasons include `CONNECTION_FAILED`, `REPLY_TIMEOUT`, `TRANSPORT_DISCONNECTED`, and `BATCH_TIME_LIMIT`.

Before and after each live conversation, the evaluator reads the dedicated agent through the [official Get agent API](https://elevenlabs.io/docs/api-reference/agents/get). It records the configured model, temperature, reasoning setting, backup-model settings and hashes of the prompt, greeting, tool references and revision. It refuses an unexpected agent, disabled authentication, a prompt differing from this repository, or a tool-count mismatch. A changed fingerprint during a conversation makes that run inconclusive; mixed fingerprints across otherwise passing runs prevent overall batch success. A shared `VOICE_SYSTEM_PROMPT` is used by setup and evaluation to avoid divergent instruction copies.

## Limits and initial results

Offline mode validates the harness and real backend with scripted replies; it cannot establish live-model quality. Configuration capture records the configured model and fallback policy, not proof of the exact model that served each turn. Provider defaults and underlying model weights are not frozen. Referenced remote tool definitions are not downloaded; local tool definitions and remote references are fingerprinted. The SDK exposes no universal end-of-turn callback, so the evaluator waits for an agent response after tool completion and then two seconds without another response/tool. Agent disconnect can complete a reply only after that post-tool response; a pre-tool “I will check” preface is insufficient. Controlled SDK-event tests cover the early greeting race, waiting for tools/final responses, premature disconnect, normal agent ending, and reply timeout. A delayed follow-on action can exceed the quiet interval. Timeouts are inconclusive, and successful samples still need human review.

Reply checks are deliberately narrow. Naming a flight and UTC does not prove every read-back detail is correct, and matching known follow-up phrases is not a full language-quality assessment. No flight number after failed identity is one disclosure check, not a comprehensive privacy audit. The backend requires a positive confirmation flag; the live check evaluates whether the model sends that flag only after explicit approval in these scenarios.

On 13 November 2026, **one live run of each of the five scenarios passed**, with durations of 16.229 seconds (rebooking), 8.031 seconds (no alternatives), 9.466 seconds (failed verification), 20.819 seconds (expired hold), and 13.423 seconds (employee takeover), including connection/greeting handling. The no-alternatives and identity runs avoided the stock follow-up previously observed after escalation. See [the recorded sample summary](evaluations/2026-11-13.json). Five single successful samples are not a reliability estimate.

The later seven-scenario, two-repetition matrix ran from a clean `15ba7de` source revision. **Six samples passed, none failed a behavioral check, and eight were inconclusive because their connections could not start.** The completed samples were rebooking, no alternatives, failed verification, expired hold, employee takeover, and unclear approval, all under the same captured fingerprint with configured model `deepseek-v41-flash` and temperature 0. The new declined-hold case and all second repetitions were inconclusive. One isolated declined-hold retry was also inconclusive. This batch did not pass overall and does not establish repeated reliability.

A separate connection diagnostic obtained a signed URL successfully (HTTP 200), but the SDK connection was rejected before session metadata with close code `3000`. The underlying provider cause remains undetermined; no billing, quota, or configuration cause is claimed. See [the complete sanitized matrix and retry results](evaluations/2026-11-13-matrix.json). The initial evaluator discarded metadata on connection errors, so its `configurationConsistent: false` reflects missing metadata rather than evidence of differing fingerprints. The later diagnostic/report-preservation changes are covered by automated tests; they were not used to rewrite these historical results.

The initial five samples above predate configuration capture. No new settings are assigned to them retroactively. Microphone, interruption, audio, and production acceptance remain pending. Next, check the provider-side reason for the rejected connection, then rerun the fixed seven-case matrix under a captured configuration. Preserve the inconclusive batch as part of the evaluation history.
