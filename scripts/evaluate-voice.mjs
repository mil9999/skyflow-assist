import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { summarizeEvaluation, shouldStopLiveBatch } from "./evaluation-summary.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scenarios = ["rebooking", "no-alternatives", "failed-verification", "expired-hold", "employee-takeover", "unclear-approval", "declined-hold"];
const args = process.argv.slice(2);
const usage = `Usage: npm run eval:voice -- (--offline | --live) [--scenario all|${scenarios.join("|")}] [--runs 1..5] [--max-minutes 1..30] [--output new-report.json]\n--offline rehearses scripted fixtures without AI calls. --live uses ElevenLabs account credits through text mode (no microphone). Reports contain checks and tool names, not credentials or full transcripts. Batch time limit defaults to 15 minutes. Output files are never overwritten.`;
if (!args.length || args.includes("--help")) { console.log(usage); process.exit(0); }
let mode; let selected = "all"; let runs = 1; let maxMinutes = 15; let output;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if ((arg === "--offline" || arg === "--live") && !mode) mode = arg.slice(2);
  else if (arg === "--scenario") selected = args[++i];
  else if (arg === "--runs") runs = Number(args[++i]);
  else if (arg === "--max-minutes") maxMinutes = Number(args[++i]);
  else if (arg === "--output") output = args[++i];
  else { console.error(usage); process.exit(2); }
}
if (!mode || !["all", ...scenarios].includes(selected) || !Number.isInteger(runs) || runs < 1 || runs > 5 || !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 30 || (args.includes("--output") && !output)) { console.error(usage); process.exit(2); }
if (mode === "live" && typeof WebSocket === "undefined") { console.error("Live evaluation requires Node.js 22 or newer."); process.exit(2); }
let reportFile;
if (output) {
  try { reportFile = openSync(resolve(output), "wx", 0o600); }
  catch { console.error("Could not create report file. Use a new writable path."); process.exit(2); }
}
nextEnv.loadEnvConfig(root);
const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "unknown";
const dirty = Boolean(spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout?.trim());
const results = [];
let connectionBlocked = false;
const deadline = Date.now() + maxMinutes * 60_000;
for (let run = 1; run <= runs; run++) {
  for (const scenario of selected === "all" ? scenarios : [selected]) {
    if (connectionBlocked) { results.push({ run, scenario, outcome: "inconclusive", reason: "BATCH_CONNECTION_BLOCKED" }); continue; }
    if (Date.now() >= deadline) { results.push({ run, scenario, outcome: "inconclusive", reason: "BATCH_TIME_LIMIT" }); continue; }
    const directory = mkdtempSync(join(tmpdir(), "skyflow-evaluation-"));
    const database = join(directory, "evaluation.db");
    writeFileSync(database, "");
    writeFileSync(join(directory, "evaluation-disposable.marker"), "Disposable fictional evaluation data.\n");
    const env = { ...process.env, DATABASE_URL: `file:${database}`, SKYFLOW_EVALUATION_DATABASE: database, SKYFLOW_EVALUATION_REVISION: revision, SKYFLOW_EVALUATION_DIRTY: String(dirty) };
    try {
      const migration = spawnSync(process.execPath, [join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env, encoding: "utf8", timeout: Math.max(1, Math.min(30_000, deadline - Date.now())), killSignal: "SIGKILL" });
      if (migration.status !== 0) throw new Error("migration");
      const worker = spawnSync(process.execPath, ["--import", "tsx", join(root, "scripts/evaluate-voice-worker.ts"), scenario, mode], { cwd: root, env, encoding: "utf8", timeout: Math.max(1, Math.min(300_000, deadline - Date.now())), killSignal: "SIGKILL", maxBuffer: 1_000_000 });
      if (worker.error) throw new Error("timeout");
      results.push({ run, scenario, ...JSON.parse(worker.stdout.trim()) });
    } catch {
      results.push({ run, scenario, mode, outcome: "inconclusive", ...(Date.now() >= deadline ? { reason: "BATCH_TIME_LIMIT" } : {}), error: "Evaluation setup, transport, or process timeout failed. No success is claimed." });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    if (mode === "live") console.error(`${scenario} run ${run}/${runs}: ${results.at(-1).outcome}`);
    if (mode === "live" && shouldStopLiveBatch(results)) { connectionBlocked = true; console.error("Stopping live connections after two consecutive provider/connection failures; remaining runs are inconclusive."); }
  }
}
const summary = summarizeEvaluation(results, mode === "live");
const report = JSON.stringify({ mode: mode === "live" ? "live-elevenlabs-text" : "offline-scripted", startedAt: new Date(deadline - maxMinutes * 60_000).toISOString(), sourceRevision: revision, worktreeDirty: dirty, results, summary, passed: summary.passed }, null, 2);
console.log(report);
if (reportFile !== undefined) {
  try { writeFileSync(reportFile, report + "\n"); }
  catch { console.error("Report could not be saved; JSON is available on stdout."); process.exitCode = 1; }
  finally { closeSync(reportFile); }
}
if (!summary.passed) process.exitCode = 1;
