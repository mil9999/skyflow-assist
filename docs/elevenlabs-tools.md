# ElevenLabs webhook tool map

Configure these in the ElevenLabs agent as **webhook tools**. The tool name is what
the language model reasons about, so it is descriptive; the URL stays short.

Every request needs the header:

```text
X-API-Key: <TOOLS_API_KEY from .env>
```

Base URL is `http://localhost:3000` in development, and the deployed origin later.

| ElevenLabs tool name | Method + path | Purpose |
|---|---|---|
| `start_conversation_session` | `POST /api/tools/start-session` | Open a session. Call once, at the greeting. |
| `verify_passenger_identity` | `POST /api/tools/verify-passenger` | Check booking reference + surname. Nothing else works until this passes. |
| `get_disrupted_booking` | `POST /api/tools/get-booking` | Fetch the cancelled flight and the reason. |
| `search_alternative_flights` | `POST /api/tools/search-flights` | Up to three eligible replacements. |
| `hold_selected_flight` | `POST /api/tools/hold-flight` | Reserve one seat for ten minutes. |
| `confirm_flight_rebooking` | `POST /api/tools/confirm-rebooking` | Commit the change. Only after an explicit spoken yes. |
| `transfer_to_human_agent` | `POST /api/tools/escalate` | Hand over to a person. |

## Request bodies

```jsonc
// start_conversation_session
{ "channel": "VOICE" }                       // optional, defaults to VOICE

// verify_passenger_identity
{ "sessionId": "...", "bookingReference": "SKY82Q", "lastName": "Martin" }

// get_disrupted_booking
{ "sessionId": "..." }

// search_alternative_flights
{ "sessionId": "...", "directOnly": true, "latestArrivalTime": "2026-08-14T18:00:00Z" }

// hold_selected_flight
{ "sessionId": "...", "flightId": "..." }    // flightId comes from the search result

// confirm_flight_rebooking
{ "sessionId": "...", "holdId": "...", "confirmed": true, "idempotencyKey": "call-<id>-confirm" }

// transfer_to_human_agent
{ "sessionId": "...", "reason": "PASSENGER_REQUEST" }
```

`reason` must be one of `VERIFICATION_FAILED`, `NO_ALTERNATIVE_FLIGHTS`,
`PASSENGER_REQUEST`, `POLICY_EXCEPTION`, `BACKEND_ERROR`.

## Responses

Success:

```json
{ "ok": true, "data": { } }
```

Failure:

```json
{ "ok": false, "code": "HOLD_EXPIRED", "message": "That seat hold has expired. Let me look again." }
```

`message` is safe to read aloud verbatim. The agent should never invent an
explanation of its own when a call fails.

| Status | Meaning for the agent |
|---|---|
| 400 | Bad arguments — a bug in the tool call, not the passenger's fault. Apologise and escalate. |
| 401 | Wrong booking reference or surname. Ask once more, then escalate. |
| 404 | Booking not found. Escalate. |
| 409 | Legitimate refusal — out of order, no options, seat gone, already rebooked. Explain and offer a next step. |
| 410 | The hold expired. Search again. |
| 422 | Confirmation missing. Ask the yes/no question again. |
| 500 | Our fault. Apologise and escalate. |

## Rules for the agent prompt

- Never state a flight, time, price or seat count that did not come from `search_alternative_flights`.
- Never call `confirm_flight_rebooking` until the passenger has said yes to a read-back of the specific flight.
- Use one `idempotencyKey` per confirmation attempt and reuse it on retry — never generate a fresh one to "try again".
- On any 5xx, call `transfer_to_human_agent` rather than retrying.
