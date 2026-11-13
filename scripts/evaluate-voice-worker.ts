import { existsSync, realpathSync, readFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { tmpdir } from "node:os";

// Refuse direct invocation against a saved demo or an arbitrary database.
const database = process.env.SKYFLOW_EVALUATION_DATABASE;
let safe = false;
try {
  if (database && process.env.DATABASE_URL === `file:${database}` && existsSync(database)) {
    const directory = realpathSync(dirname(database));
    safe = basename(directory).startsWith("skyflow-evaluation-") && dirname(directory) === realpathSync(tmpdir())
      && realpathSync(database) === join(directory, "evaluation.db")
      && existsSync(join(directory, "evaluation-disposable.marker"));
  }
} catch { /* Invalid or inaccessible paths are never disposable databases. */ }
if (!safe) {
  console.log(JSON.stringify({ outcome: "inconclusive", error: "A disposable evaluation database is required. Use npm run eval:voice." }));
  process.exit(1);
}

async function main() {
  // Dynamic imports are intentional: isolation must be validated before Prisma.
  const { prisma } = await import("../src/server/db/prisma");
  try {
    const { VOICE_EVALUATION_SCENARIOS } = await import("../src/evaluation/voice-scenarios");
    const scenario = VOICE_EVALUATION_SCENARIOS.find((item) => item.id === process.argv[2]);
    if (!scenario) throw new Error("Unknown evaluation scenario.");
    const { evaluateVoiceScenario, evaluateConfiguredVoiceScenario } = await import("../src/evaluation/voice-runner");
    const live = process.argv[3] === "live";
    const transport = live
      ? new (await import("../src/evaluation/elevenlabs-transport")).ElevenLabsEvaluationTransport()
      : new (await import("../src/evaluation/scripted-transport")).ScriptedEvaluationTransport(scenario.id);
    const result = live ? await evaluateConfiguredVoiceScenario(scenario, transport) : await evaluateVoiceScenario(scenario, transport);
    console.log(JSON.stringify({ outcome: result.passed ? "passed" : "failed", mode: live ? "live" : "offline-scripted", ...result,
      runtime: { node: process.version, sdkVersion: JSON.parse(readFileSync(join(process.cwd(), "node_modules/@elevenlabs/client/package.json"), "utf8")).version,
        sourceRevision: process.env.SKYFLOW_EVALUATION_REVISION ?? "unknown", worktreeDirty: process.env.SKYFLOW_EVALUATION_DIRTY === "true" } }));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    // Never print SDK errors, request headers, signed URLs, or transcripts.
    const known: Record<string, string> = {
      "Live evaluation requires Node.js 22 or newer with built-in WebSocket support.": "UNSUPPORTED_RUNTIME",
      "Could not start the live ElevenLabs evaluation. Check credentials, agent access, and network connectivity.": "CONNECTION_FAILED",
      "No completed agent reply within 45 seconds; this run is inconclusive.": "REPLY_TIMEOUT",
      "ElevenLabs reported a conversation error.": "PROVIDER_ERROR",
      "ElevenLabs disconnected unexpectedly.": "TRANSPORT_DISCONNECTED",
      "The live conversation is no longer open.": "CONVERSATION_CLOSED",
      "The agent disconnected before completing its reply.": "INCOMPLETE_REPLY",
      "A local evaluation tool failed.": "LOCAL_TOOL_FAILED",
      AGENT_CONFIGURATION_UNAVAILABLE: "AGENT_CONFIGURATION_UNAVAILABLE",
      AGENT_CONFIGURATION_INVALID: "AGENT_CONFIGURATION_INVALID",
      AGENT_PROMPT_OUT_OF_SYNC: "AGENT_PROMPT_OUT_OF_SYNC",
      AGENT_TOOLS_OUT_OF_SYNC: "AGENT_TOOLS_OUT_OF_SYNC",
    };
    const reason = error instanceof Error ? known[error.message] ?? "LOCAL_EVALUATION_ERROR" : "LOCAL_EVALUATION_ERROR";
    console.log(JSON.stringify({ outcome: "inconclusive", reason, error: "Evaluation could not finish. Check Node.js version, credentials, network, and agent configuration. No live success is claimed." }));
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
void main();
