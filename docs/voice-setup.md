# ElevenLabs voice setup

The local browser integration is implemented at `/voice`. It uses authenticated ElevenLabs conversations and bridges client tools to the airline backend. Live agent checks through text mode have passed; microphone audio quality still needs a spoken test.

## Store the credentials locally

Edit `.env` at the repository root, alongside `package.json`:

```dotenv
ELEVENLABS_API_KEY="your-api-key"
ELEVENLABS_AGENT_ID="your-agent-id"
```

`.env` is ignored by Git. Keep the API key server-side; do not add a `NEXT_PUBLIC_` prefix or paste it into GitHub. `.env.example` contains empty placeholders only.

The API key authenticates this app to ElevenLabs. The agent ID selects the conversational agent configured in your ElevenLabs account. It is a separate value, not another API key.

## Create the conversational agent

With the API key set and the agent ID empty, run:

```bash
npm run setup:voice -- --create
```

This creates a dedicated **SkyFlow Assist** agent, attaches seven blocking client tools, enables signed authentication, verifies the configuration, and writes the agent ID to `.env`. It does not modify your other agents. An ignored `.env.elevenlabs-setup.json` checkpoint lets an interrupted run resume without recreating completed tools. Do not copy that checkpoint between accounts.

Running the command again verifies the dedicated agent and synchronizes its instructions with this repository. It does not overwrite a different configured agent.

The tool schema comes from `src/agent/tool-definitions.ts`; behavior comes from `src/agent/system-prompt.ts`. The [ElevenLabs quickstart](https://elevenlabs.io/docs/eleven-agents/quickstart/) also explains the dashboard. If you configure an agent manually, all seven tools must be client tools with matching names and parameters and **Wait for response** enabled.

Restart the development server to load credentials, then open `http://127.0.0.1:3000/voice`. **Start voice conversation** requests microphone access. **Use text instead of microphone** tests the same live agent and tools without audio. Both modes use your ElevenLabs account credits.

## Browser integration

The server requests a short-lived [signed conversation URL](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url) using the local key and agent ID. The browser uses the [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react) for the conversation. The permanent API key is never returned to the browser. The agent's own authentication is enabled; domain allowlisting is not combined with signed authentication.

The airline backend will continue to control identity verification, eligible flights, inventory, holds, and confirmation. The voice agent must read back a held flight and receive an explicit passenger yes before requesting confirmation. A support case currently records an escalation; it does not connect a live employee.

The browser forwards only named client-tool calls to the local server. The server injects real airline session, flight, hold, and idempotency IDs. Tool requests are serialized per conversation and cached by call ID for transport retries. Ending a call releases an unconfirmed seat; support escalation also releases it. Page-leave cleanup is best effort and does not replace a durable expiry worker.

The voice routes are restricted to loopback hosts in development and reject foreign browser origins. They are disabled in production until application login and hosting controls are added. Voice context is in memory; transcripts currently live in the browser. Cloud-hosted [webhook tools](elevenlabs-tools.md) are an alternative deployment design and require a reachable HTTPS backend.

Automated bridge checks cover credentials, origin restrictions, verification, duplicate requests, explicit confirmation, seat release, and escalation using mocked ElevenLabs responses and the real airline database.

Live agent testing through the browser's text mode verified no available flights and support-case creation, flight search, holding a seat, refusing to confirm after an ambiguous “maybe,” releasing a declined hold, reading back a different flight, and rebooking only after an explicit yes. Two failed identity checks also escalated without disclosing booking details. The confirmed booking and inventory were checked directly in SQLite. These are individual successful runs, not a reliability measurement. Spoken rebooking, speech recognition, audio quality, interruption handling, and live expired-hold recovery remain acceptance work.
