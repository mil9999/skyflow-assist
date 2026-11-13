import { prisma } from "../../src/server/db/prisma";
import { endVoiceSession, runVoiceTool, VoiceSessionError } from "../../src/server/voice/sessions";
async function main() {
  const [mode, id, callId, name, args] = process.argv.slice(2);
  try { console.log(JSON.stringify(mode === "end" ? await endVoiceSession(id) : await runVoiceTool(id, callId, name, JSON.parse(args ?? "{}")))); }
  catch (error) { console.log(JSON.stringify({ error: error instanceof VoiceSessionError ? error.status : 500 })); }
}
main().finally(() => prisma.$disconnect());
