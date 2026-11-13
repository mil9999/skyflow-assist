import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = ["rebooking", "no-alternatives", "failed-verification", "expired-hold", "employee-takeover"];
const args = process.argv.slice(2);
const usage = `Usage: npm run eval:voice -- (--offline | --live) [--scenario all|${scenarios.join("|")}] [--runs 1..5]\n--offline rehearses scripted fixtures without AI calls. --live uses ElevenLabs account credits through text mode (no microphone). Reports contain checks and tool names, not credentials or full transcripts.`;
if (!args.length || args.includes("--help")) { console.log(usage); process.exit(0); }
let mode; let selected = "all"; let runs = 1;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if ((arg === "--offline" || arg === "--live") && !mode) mode = arg.slice(2);
  else if (arg === "--scenario") selected = args[++i];
  else if (arg === "--runs") runs = Number(args[++i]);
  else { console.error(usage); process.exit(2); }
}
if (!mode || !["all", ...scenarios].includes(selected) || !Number.isInteger(runs) || runs < 1 || runs > 5) { console.error(usage); process.exit(2); }
if (mode === "live" && typeof WebSocket === "undefined") { console.error("Live evaluation requires Node.js 22 or newer."); process.exit(2); }
nextEnv.loadEnvConfig(root);
const results = [];
for (let run = 1; run <= runs; run++) {
  for (const scenario of selected === "all" ? scenarios : [selected]) {
    const directory = mkdtempSync(join(tmpdir(), "skyflow-evaluation-"));
    const database = join(directory, "evaluation.db");
    writeFileSync(database, "");
    writeFileSync(join(directory, "evaluation-disposable.marker"), "Disposable fictional evaluation data.\n");
    const env = { ...process.env, DATABASE_URL: `file:${database}`, SKYFLOW_EVALUATION_DATABASE: database };
    try {
      const migration = spawnSync(process.execPath, [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
      if (migration.status !== 0) throw new Error("migration");
      const worker = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/evaluate-voice-worker.ts"), scenario, mode], { cwd: root, env, encoding: "utf8", timeout: 300_000, killSignal: "SIGKILL", maxBuffer: 1_000_000 });
      if (worker.error) throw new Error("timeout");
      results.push({ run, scenario, ...JSON.parse(worker.stdout.trim()) });
    } catch {
      results.push({ run, scenario, mode, outcome: "inconclusive", error: "Evaluation setup, transport, or process timeout failed. No success is claimed." });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
console.log(JSON.stringify({ mode: mode === "live" ? "live-elevenlabs-text" : "offline-scripted", results, passed: results.every((item) => item.outcome === "passed") }, null, 2));
if (results.some((item) => item.outcome !== "passed")) process.exitCode = 1;
