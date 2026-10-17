import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { SYSTEM_PROMPT } from "../src/agent/system-prompt";
import { AGENT_TOOLS } from "../src/agent/tool-definitions";

loadEnvConfig(process.cwd());
const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) throw new Error("Set ELEVENLABS_API_KEY in .env first.");
if (!process.argv.includes("--create")) throw new Error("Use npm run setup:voice -- --create to create a dedicated SkyFlow agent.");
const cachePath = ".env.elevenlabs-setup.json";
const cache: { tools: Record<string, string>; agentId?: string } = existsSync(cachePath)
  ? JSON.parse(readFileSync(cachePath, "utf8")) : { tools: {} };
const save = () => writeFileSync(cachePath, JSON.stringify(cache, null, 2), { mode: 0o600 });
const configured = process.env.ELEVENLABS_AGENT_ID?.trim();
if (configured && configured !== cache.agentId) {
  throw new Error("An agent ID is already configured. This creation script will not overwrite it.");
}

async function api(path: string, body?: unknown, method = body ? "POST" : "GET") {
  const response = await fetch(`https://api.elevenlabs.io/v1/convai${path}`, {
    method,
    headers: { "xi-api-key": key!, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    // Validation locations help diagnose configuration without printing credentials.
    const validation = Array.isArray(data?.detail) ? data.detail.map((item: { loc?: string[]; msg?: string }) => ({ field: item.loc, message: item.msg })) : undefined;
    throw new Error(`ElevenLabs configuration failed (${response.status}). ${validation ? JSON.stringify(validation) : "Check key permissions and account access."}`);
  }
  return response.json();
}

async function main() {
  const prompt = `${SYSTEM_PROMPT}\n\nThe airline conversation session is already open. Use the seven configured client tools for airline operations. Times from tools are UTC; name the time zone when reading a flight back.`;
  if (!cache.agentId) {
    for (const tool of AGENT_TOOLS) {
      if (cache.tools[tool.name]) continue;
      const source = tool.parameters as { properties: Record<string, { type: string | string[]; description?: string; enum?: string[] }> };
      const required: string[] = [];
      const properties = Object.fromEntries(Object.entries(source.properties).map(([name, property]) => {
        const nullable = Array.isArray(property.type);
        if (!nullable) required.push(name);
        return [name, { ...property, type: nullable ? property.type[0] : property.type }];
      }));
      const created = await api("/tools", { tool_config: {
        type: "client", name: tool.name, description: tool.description,
        expects_response: true, response_timeout_secs: 20,
        parameters: { type: "object", properties, required, description: `Arguments for ${tool.name}.` },
      } });
      cache.tools[tool.name] = created.id;
      save();
      console.log(`Configured client tool: ${tool.name}`);
    }
    const agent = await api("/agents/create", {
      name: "SkyFlow Assist", tags: ["skyflow-assist", "local-demo"],
      conversation_config: {
        agent: {
          first_message: "Hello, I'm SkyFlow Assist. I can help with your cancelled flight. What is your booking reference and surname?",
          language: "en",
          prompt: {
            prompt,
            tool_ids: AGENT_TOOLS.map((tool) => cache.tools[tool.name]),
          },
        },
        conversation: { max_duration_seconds: 600, client_events: ["audio", "interruption", "user_transcript", "agent_response", "client_tool_call"] },
      },
      platform_settings: { auth: { enable_auth: true } },
    });
    cache.agentId = agent.agent_id;
    save();
  }
  let agent = await api(`/agents/${encodeURIComponent(cache.agentId!)}`);
  if (agent.name !== "SkyFlow Assist" || !agent.platform_settings?.auth?.enable_auth) {
    throw new Error("The created agent did not pass the name and authentication check.");
  }
  const configuredTools: string[] = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  if (AGENT_TOOLS.some((tool) => !configuredTools.includes(cache.tools[tool.name]))) {
    throw new Error("The created agent is missing airline tools.");
  }
  if (agent.conversation_config.agent.prompt.prompt !== prompt) {
    await api(`/agents/${encodeURIComponent(cache.agentId!)}`, {
      conversation_config: { agent: { prompt: { prompt, tool_ids: configuredTools } } },
    }, "PATCH");
    agent = await api(`/agents/${encodeURIComponent(cache.agentId!)}`);
    if (agent.conversation_config?.agent?.prompt?.prompt !== prompt || !agent.platform_settings?.auth?.enable_auth
      || AGENT_TOOLS.some((tool) => !agent.conversation_config?.agent?.prompt?.tool_ids?.includes(cache.tools[tool.name]))) {
      throw new Error("The updated agent configuration could not be verified.");
    }
    console.log("Synchronized the dedicated agent's instructions with this repository.");
  }
  const envPath = ".env";
  let env = readFileSync(envPath, "utf8");
  const line = `ELEVENLABS_AGENT_ID="${cache.agentId}"`;
  env = /^ELEVENLABS_AGENT_ID\s*=.*$/m.test(env) ? env.replace(/^ELEVENLABS_AGENT_ID\s*=.*$/m, line) : `${env.trimEnd()}\n${line}\n`;
  if (readFileSync(envPath, "utf8") !== env) writeFileSync(envPath, env, { mode: 0o600 });
  console.log("SkyFlow Assist agent configured and verified. Agent ID is saved in the ignored local .env.");
  console.log(`Configured ${agent.conversation_config?.agent?.prompt?.tool_ids?.length ?? 0} airline tools. Restart npm run dev to load the credentials.`);
}

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1; });
