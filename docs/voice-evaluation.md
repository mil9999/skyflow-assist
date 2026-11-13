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

# Opt into all five live scenarios, repeated three times each.
npm run eval:voice -- --live --scenario all --runs 3
```

Live mode uses the existing ignored `.env` values `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`, sends only the fictional scenario messages and tool results to ElevenLabs, and consumes account credits. Configure the dedicated agent using [voice setup](voice-setup.md). Running the command without a mode prints usage; it never starts a live call implicitly. Runs are limited to 1–5 per scenario. Use `npm run --silent eval:voice -- ...` if you need stdout to contain only the JSON report.

Every scenario/repetition gets a fresh temporary SQLite database with the real migrations and tomorrow's fictional flights. The worker refuses a saved demo path, a missing disposable marker, or a database symlink. It closes the conversation, releases an unconfirmed AI hold, and removes its temporary database. The saved development database is never reset. Each worker has a five-minute process limit and each awaited agent reply has a 45-second limit.

## What is checked

| Scenario | Checks |
|---|---|
| `rebooking` | Verify identity, present alternatives, hold SF218, name SF218 and UTC in the read-back, keep the booking unchanged after “maybe,” then rebook SF218 with exactly one confirmation event after explicit approval |
| `no-alternatives` | Create a no-alternatives support case, enter ESCALATED, leave the booking unchanged, and avoid the previously observed stock follow-up question |
| `failed-verification` | Record one then two failed checks, keep the booking unlinked, avoid flight numbers in replies, and escalate to identity review |
| `expired-hold` | Expire the original held seat, refuse to rebook from old approval, create a distinct fresh hold, repeat the read-back, and confirm once after a new explicit yes |
| `employee-takeover` | Take over a held seat, refuse a deliberately delayed AI confirmation probe, direct the passenger to shared text, disconnect the AI transport, and retain employee control and its held seat |

The expiry scenario moves the saved deadline into the past and runs the real expiry service, so it does not wait ten minutes. An attempted confirmation of the old hold may be refused by the backend; the check requires that its approval never completes a replacement booking. A fresh hold and read-back must precede the final new approval.

The takeover scenario invokes the trusted employee service and tests a delayed AI request separately from model-generated tools. The user message then tells the live agent that staff joined, and the evaluator closes the AI transport before checking the preserved hold. This checks server ownership and the agent's text-handover response; the browser's polling/disconnection UI and actual employee messages are covered by separate acceptance checks.

Checks inspect persisted backend state, audit counts, attempted tool calls, and selected reply patterns. The run stops at its first failed check so later actions cannot hide a premature booking change. The regular test suite includes deliberately unsafe fixtures that treat “maybe” as approval, reuse old consent for a replacement hold, or release a staff-owned seat on disconnect; the evaluator must flag each failure.

Reports include scenario names, check outcomes, tool names, backend state, and elapsed time. They omit credentials, signed URLs, internal airline IDs, and full transcripts. Exit code 0 means all requested checks passed; 1 means a failed or inconclusive run; 2 means invalid options or unsupported live runtime. Inconclusive results include a safe reason code where available, such as `CONNECTION_FAILED`, `REPLY_TIMEOUT`, or `TRANSPORT_DISCONNECTED`. Fix setup/transport failures before interpreting model quality.

## Limits and initial results

Offline mode validates the harness and real backend with scripted replies; it cannot establish live-model quality. Live mode uses the agent's current account configuration, which is not pinned by this command. The SDK exposes no universal end-of-turn event, so the evaluator waits for an agent response after tool completion and then two seconds without another response/tool. A delayed follow-on action can exceed that quiet interval. Timeouts are inconclusive, and successful samples still need human review.

Reply checks are deliberately narrow. Naming a flight and UTC does not prove every read-back detail is correct, and matching known follow-up phrases is not a full language-quality assessment. No flight number after failed identity is one disclosure check, not a comprehensive privacy audit. The backend requires a positive confirmation flag; the live check evaluates whether the model sends that flag only after explicit approval in these scenarios.

On 13 November 2026, **one live run of each of the five scenarios passed**, with durations of 16.229 seconds (rebooking), 8.031 seconds (no alternatives), 9.466 seconds (failed verification), 20.819 seconds (expired hold), and 13.423 seconds (employee takeover), including connection/greeting handling. The no-alternatives and identity runs avoided the stock follow-up previously observed after escalation. See [the recorded sample summary](evaluations/2026-11-13.json). Five single successful samples are not a reliability estimate.

Next: broaden ambiguous/declined approval wording, capture agent/model configuration, repeat a fixed matrix, and review full spoken journeys with the user. Microphone, interruption, audio, and production acceptance remain pending.
