import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE_SYSTEM_PROMPT } from "../src/agent/system-prompt";
import { snapshotAgentConfiguration, getEvaluationAgentConfiguration } from "../src/evaluation/agent-configuration";
import { summarizeEvaluation } from "../scripts/evaluation-summary.mjs";
import { evaluateConfiguredVoiceScenario } from "../src/evaluation/voice-runner";
import { ScriptedEvaluationTransport } from "../src/evaluation/scripted-transport";
import { VOICE_EVALUATION_SCENARIOS } from "../src/evaluation/voice-scenarios";
import { prisma } from "../src/server/db/prisma";

const fixture = () => ({
  name: "SkyFlow Assist", agent_id: "private-agent-selector", version_id: "private-version-selector",
  platform_settings: { auth: { enable_auth: true }, secret: "private-setting" },
  metadata: { updated_at_unix_secs: 123 },
  phone_numbers: ["private-contact"],
  conversation_config: { agent: { language: "en", first_message: "Hello", prompt: {
    prompt: VOICE_SYSTEM_PROMPT, llm: "fixture-model", temperature: 0, max_tokens: 500,
    tool_ids: Array.from({ length: 7 }, (_, i) => `private-tool-${i}`),
    custom_llm: { api_key: "private-api-value", url: "https://private.example.invalid/endpoint" },
  } } },
});
beforeEach(() => { vi.stubEnv("ELEVENLABS_API_KEY", "fixture-key"); vi.stubEnv("ELEVENLABS_AGENT_ID", "fixture-agent"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(() => prisma.$disconnect());

describe("evaluation configuration", () => {
  it("records whitelisted settings and hashes without exposing provider data", () => {
    const config = snapshotAgentConfiguration(fixture());
    expect(config).toMatchObject({ configuredModel: "fixture-model", temperature: 0, remoteToolCount: 7, matchesLocalPrompt: true });
    expect(config.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(config)).not.toMatch(/private-|custom_llm|api_key|Hello|Hello, I'm/);
  });
  it("detects model and prompt changes", () => {
    const original = snapshotAgentConfiguration(fixture());
    const model = fixture(); model.conversation_config.agent.prompt.llm = "other-model";
    const prompt = fixture(); prompt.conversation_config.agent.prompt.prompt += "Changed";
    expect(snapshotAgentConfiguration(model).fingerprint).not.toBe(original.fingerprint);
    expect(snapshotAgentConfiguration(prompt)).toMatchObject({ matchesLocalPrompt: false });
    expect(snapshotAgentConfiguration(prompt).fingerprint).not.toBe(original.fingerprint);
  });
  it("ignores private response extras and tool-reference ordering", () => {
    const original = snapshotAgentConfiguration(fixture());
    const reordered = fixture(); reordered.conversation_config.agent.prompt.tool_ids.reverse(); reordered.platform_settings.secret = "different-private-setting";
    expect(snapshotAgentConfiguration(reordered).fingerprint).toBe(original.fingerprint);
  });
  it.each(["name", "auth", "model"])("refuses an invalid %s configuration", (field) => {
    const data = fixture();
    if (field === "name") data.name = "Other agent";
    if (field === "auth") data.platform_settings.auth.enable_auth = false;
    if (field === "model") data.conversation_config.agent.prompt.llm = "";
    expect(() => snapshotAgentConfiguration(data)).toThrow("AGENT_CONFIGURATION_INVALID");
  });
  it("refuses a live run whose remote prompt differs from the repository", async () => {
    const data = fixture(); data.conversation_config.agent.prompt.prompt = "Outdated instructions";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));
    await expect(getEvaluationAgentConfiguration()).rejects.toMatchObject({ reason: "AGENT_PROMPT_OUT_OF_SYNC" });
  });
  it("maps upstream failures to safe reasons without exposing error text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private signed URL and headers")));
    await expect(getEvaluationAgentConfiguration()).rejects.toMatchObject({ message: "AGENT_CONFIGURATION_UNAVAILABLE" });
  });
  it("invalidates otherwise passing checks when the agent changes during a run", async () => {
    const first = snapshotAgentConfiguration(fixture());
    const changed = fixture(); changed.conversation_config.agent.prompt.llm = "other-model";
    const read = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(snapshotAgentConfiguration(changed));
    const scenario = VOICE_EVALUATION_SCENARIOS.find((item) => item.id === "no-alternatives")!;
    const report = await evaluateConfiguredVoiceScenario(scenario, new ScriptedEvaluationTransport(scenario.id), read);
    expect(report).toMatchObject({ outcome: "inconclusive", passed: false, reason: "AGENT_CONFIGURATION_CHANGED" });
    expect(report.steps.every((step) => step.checks.every((check) => check.passed))).toBe(true);
  });
});

describe("evaluation batch summary", () => {
  it("counts failures and inconclusive runs separately", () => {
    const result = summarizeEvaluation([
      { scenario: "one", outcome: "passed" },
      { scenario: "one", outcome: "failed", steps: [{ checks: [{ name: "approval required", passed: false }] }] },
      { scenario: "two", outcome: "inconclusive" },
    ], false);
    expect(result).toMatchObject({ total: 3, passed: false, counts: { passed: 1, failed: 1, inconclusive: 1 }, scenarios: { one: { runs: 2, failedChecks: ["approval required"] } } });
  });
  it("rejects a live batch that silently mixes configurations", () => {
    const results = ["first", "second"].map((fingerprint) => ({ scenario: "one", outcome: "passed", configuration: { fingerprint } }));
    expect(summarizeEvaluation(results, true)).toMatchObject({ passed: false, configurationConsistent: false });
  });
  it("requires matching configuration metadata for live success", () => {
    expect(summarizeEvaluation([{ scenario: "one", outcome: "passed" }], true).passed).toBe(false);
    const results = [1, 2].map(() => ({ scenario: "one", outcome: "passed", configuration: { fingerprint: "same" } }));
    expect(summarizeEvaluation(results, true)).toMatchObject({ passed: true, configurationConsistent: true });
    expect(summarizeEvaluation([{ scenario: "one", outcome: "passed" }], false).passed).toBe(true);
  });
});
