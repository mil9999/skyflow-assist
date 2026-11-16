import { createHash } from "node:crypto";
import { z } from "zod";

import { VOICE_SYSTEM_PROMPT } from "../agent/system-prompt";
import { AGENT_TOOLS } from "../agent/tool-definitions";

export type ConfigurationFailure = "AGENT_CONFIGURATION_UNAVAILABLE" | "AGENT_CONFIGURATION_INVALID" | "AGENT_PROMPT_OUT_OF_SYNC" | "AGENT_TOOLS_OUT_OF_SYNC";
export class AgentConfigurationError extends Error {
  constructor(public reason: ConfigurationFailure) { super(reason); }
}

const schema = z.object({
  name: z.literal("SkyFlow Assist"),
  version_id: z.string().nullish(), branch_id: z.string().nullish(),
  metadata: z.object({ updated_at_unix_secs: z.number().optional() }).optional(),
  platform_settings: z.object({ auth: z.object({ enable_auth: z.literal(true) }) }),
  conversation_config: z.object({
    conversation: z.object({ max_duration_seconds: z.number().optional() }).optional(),
    agent: z.object({
      language: z.string().max(40).optional(), first_message: z.string().optional(),
      prompt: z.object({
        prompt: z.string().min(1), llm: z.string().min(1).max(100),
        temperature: z.number().nullish(), max_tokens: z.number().nullish(),
        reasoning_effort: z.string().max(40).nullish(), service_tier: z.string().max(40).optional(),
        backup_llm_config: z.object({ preference: z.enum(["default", "disabled", "override"]), order: z.array(z.string().max(100)).optional() }).nullish(),
        cascade_timeout_seconds: z.number().optional(),
        tool_ids: z.array(z.string()), enable_parallel_tool_calls: z.boolean().optional(),
      }),
    }),
  }),
});

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Whitelist scalar settings and hashes. Never return the full provider object. */
export function snapshotAgentConfiguration(body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AgentConfigurationError("AGENT_CONFIGURATION_INVALID");
  const agent = parsed.data.conversation_config.agent;
  const prompt = agent.prompt;
  const settings = {
    provider: "elevenlabs", agent: "SkyFlow Assist", configuredModel: prompt.llm,
    temperature: prompt.temperature === undefined ? "not-reported" : prompt.temperature,
    reasoningEffort: prompt.reasoning_effort ?? null, maxTokens: prompt.max_tokens ?? null,
    serviceTier: prompt.service_tier ?? "not-reported", parallelTools: prompt.enable_parallel_tool_calls ?? null,
    backupLlmConfig: prompt.backup_llm_config ?? null, cascadeTimeoutSeconds: prompt.cascade_timeout_seconds ?? null,
    language: agent.language ?? "not-reported", maxDurationSeconds: parsed.data.conversation_config.conversation?.max_duration_seconds ?? null,
    promptSha256: hash(prompt.prompt), firstMessageSha256: hash(agent.first_message ?? ""),
    localToolsSha256: hash(AGENT_TOOLS), remoteToolReferencesSha256: hash([...prompt.tool_ids].sort()),
    remoteToolCount: prompt.tool_ids.length,
    revisionSha256: hash([parsed.data.version_id ?? null, parsed.data.branch_id ?? null, parsed.data.metadata?.updated_at_unix_secs ?? null]),
    matchesLocalPrompt: prompt.prompt === VOICE_SYSTEM_PROMPT,
  };
  return { ...settings, fingerprint: hash(settings) };
}

export async function getEvaluationAgentConfiguration() {
  const key = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_AGENT_ID?.trim();
  if (!key || !agentId) throw new AgentConfigurationError("AGENT_CONFIGURATION_UNAVAILABLE");
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new AgentConfigurationError("AGENT_CONFIGURATION_UNAVAILABLE");
    const configuration = snapshotAgentConfiguration(await response.json());
    if (!configuration.matchesLocalPrompt) throw new AgentConfigurationError("AGENT_PROMPT_OUT_OF_SYNC");
    if (configuration.remoteToolCount !== AGENT_TOOLS.length) throw new AgentConfigurationError("AGENT_TOOLS_OUT_OF_SYNC");
    return configuration;
  } catch (error) {
    if (error instanceof AgentConfigurationError) throw error;
    throw new AgentConfigurationError("AGENT_CONFIGURATION_UNAVAILABLE");
  }
}
