# ElevenLabs voice setup

The text demo works now. Browser voice is the next implementation milestone; adding credentials alone does not enable it.

## Store the credentials locally

Edit `.env` at the repository root, alongside `package.json`:

```dotenv
ELEVENLABS_API_KEY="your-api-key"
ELEVENLABS_AGENT_ID="your-agent-id"
```

`.env` is ignored by Git. Keep the API key server-side; do not add a `NEXT_PUBLIC_` prefix or paste it into GitHub. `.env.example` contains empty placeholders only.

The API key authenticates this app to ElevenLabs. The agent ID selects the conversational agent configured in your ElevenLabs account. It is a separate value, not another API key.

## Create the conversational agent

Follow the [ElevenLabs agent quickstart](https://elevenlabs.io/docs/eleven-agents/quickstart/). Create an agent named **SkyFlow Assist**, choose an English voice, and use a first message such as:

> Hello, I'm SkyFlow Assist. I can help with your cancelled flight. What is your booking reference and surname?

Copy its agent ID into `.env`. The final prompt and tool configuration must be connected and tested before the agent can make bookings. Use `src/agent/system-prompt.ts` and the [airline tool map](elevenlabs-tools.md) as the source of the rebooking rules.

## Planned browser integration

The server will request a short-lived [signed conversation URL](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url) using the local key and agent ID. The browser will use the [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react) to start and stop a microphone session. The permanent API key must never be returned to the browser.

The airline backend will continue to control identity verification, eligible flights, inventory, holds, and confirmation. The voice agent must read back a held flight and receive an explicit passenger yes before requesting confirmation. A support case currently records an escalation; it does not connect a live employee.

Cloud-hosted webhook tools need a reachable HTTPS backend. ElevenLabs cannot call this computer's `localhost`. A local browser bridge is an alternative for development and still needs its own integration and validation.

Acceptance checks: successful spoken rebooking, a declined hold, expired hold recovery, failed verification, no available flights, and support escalation. These live voice checks remain pending.
