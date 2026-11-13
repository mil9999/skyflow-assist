import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db/prisma";
import { VOICE_EVALUATION_SCENARIOS } from "../src/evaluation/voice-scenarios";
import { evaluateVoiceScenario, type EvaluationTransport } from "../src/evaluation/voice-runner";
import { ScriptedEvaluationTransport } from "../src/evaluation/scripted-transport";
import { cancelHold } from "../src/server/services/rebooking-service";

afterAll(() => prisma.$disconnect());

describe("repeatable voice evaluation", () => {
  it.each(VOICE_EVALUATION_SCENARIOS)("rehearses $id against the real backend without an AI call", async (scenario) => {
    const report = await evaluateVoiceScenario(scenario, new ScriptedEvaluationTransport(scenario.id));
    expect(report.passed).toBe(true);
    expect(report.steps).toHaveLength(scenario.steps.length);
    expect(report.steps.flatMap((step) => step.checks).every((check) => check.passed)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/sessionId|holdId|flightId|signed_url|SKY82Q|Martin/);
    expect(await prisma.rebookingHold.count({ where: { status: "ACTIVE" } })).toBe(scenario.id === "employee-takeover" ? 1 : 0);
  });

  it("fails immediately if a model treats maybe as positive approval", async () => {
    const scenario = VOICE_EVALUATION_SCENARIOS[0];
    const scripted = new ScriptedEvaluationTransport(scenario.id);
    let tool!: Parameters<EvaluationTransport["start"]>[0];
    let turns = 0;
    const unsafe: EvaluationTransport = {
      start: async (execute) => { tool = execute; await scripted.start(execute); },
      exchange: async () => {
        if (++turns === 3) {
          await tool("confirm_flight_rebooking", { confirmed: true });
          return "Your booking is changed.";
        }
        return scripted.exchange();
      },
      end: () => scripted.end(),
    };
    const report = await evaluateVoiceScenario(scenario, unsafe);
    expect(report.passed).toBe(false);
    expect(report.steps).toHaveLength(3);
    expect(report.steps.at(-1)?.checks).toContainEqual({ name: "no attempted positive confirmation", passed: false });
    expect(report.steps.at(-1)?.checks).toContainEqual({ name: "no booking confirmation", passed: false });
  });

  it("refuses a worker invocation against the saved demo before importing Prisma", () => {
    const worker = spawnSync(process.execPath, ["--import", "tsx", "scripts/evaluate-voice-worker.ts", "rebooking", "offline"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: "file:./dev.db", SKYFLOW_EVALUATION_DATABASE: "" }, encoding: "utf8" });
    expect(worker.status).toBe(1);
    expect(JSON.parse(worker.stdout)).toMatchObject({ outcome: "inconclusive", error: expect.stringContaining("disposable evaluation database") });
  });

  it("flags reuse of old approval to confirm a replacement hold", async () => {
    const scenario = VOICE_EVALUATION_SCENARIOS.find((item) => item.id === "expired-hold")!;
    const scripted = new ScriptedEvaluationTransport(scenario.id);
    let tool!: Parameters<EvaluationTransport["start"]>[0];
    let turns = 0;
    const unsafe: EvaluationTransport = {
      start: async (execute) => { tool = execute; await scripted.start(execute); },
      exchange: async () => {
        if (++turns === 3) {
          await tool("search_alternative_flights", {});
          await tool("hold_selected_flight", { optionId: "option_1" });
          await tool("confirm_flight_rebooking", { confirmed: true });
          return "I reused your old yes for the new hold.";
        }
        return scripted.exchange();
      },
      end: () => scripted.end(),
    };
    const report = await evaluateVoiceScenario(scenario, unsafe);
    expect(report.passed).toBe(false);
    expect(report.steps).toHaveLength(3);
    expect(report.steps.at(-1)?.checks).toContainEqual({ name: "expired approval does not rebook", passed: false });
  });

  it("detects a lost employee hold after transport cleanup", async () => {
    const scenario = VOICE_EVALUATION_SCENARIOS.find((item) => item.id === "employee-takeover")!;
    const scripted = new ScriptedEvaluationTransport(scenario.id);
    const unsafe: EvaluationTransport = {
      start: (tool) => scripted.start(tool), exchange: () => scripted.exchange(),
      end: async () => {
        const session = await prisma.conversationSession.findFirstOrThrow({ where: { controller: "EMPLOYEE" } });
        await cancelHold({ sessionId: session.id, holdId: session.activeHoldId! }, "EMPLOYEE");
      },
    };
    const report = await evaluateVoiceScenario(scenario, unsafe);
    expect(report.passed).toBe(false);
    expect(report.steps.at(-1)?.checks).toContainEqual({ name: "employee seat survives AI disconnect", passed: false });
  });

  it("requires an explicit mode and rejects conflicting modes before connecting", () => {
    const help = spawnSync(process.execPath, ["scripts/evaluate-voice.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("ElevenLabs account credits");
    const invalid = spawnSync(process.execPath, ["scripts/evaluate-voice.mjs", "--live", "--offline"], { cwd: process.cwd(), encoding: "utf8" });
    expect(invalid.status).toBe(2);
  });

  it("refuses a disposable-looking path that links to another database", () => {
    const directory = mkdtempSync(join(tmpdir(), "skyflow-evaluation-"));
    try {
      const target = join(directory, "preserved.db");
      const database = join(directory, "evaluation.db");
      writeFileSync(target, "preserve this database");
      writeFileSync(join(directory, "evaluation-disposable.marker"), "test");
      symlinkSync(target, database);
      const worker = spawnSync(process.execPath, ["--import", "tsx", "scripts/evaluate-voice-worker.ts", "rebooking", "offline"], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: `file:${database}`, SKYFLOW_EVALUATION_DATABASE: database }, encoding: "utf8" });
      expect(worker.status).toBe(1);
      expect(JSON.parse(worker.stdout).outcome).toBe("inconclusive");
      expect(readFileSync(target, "utf8")).toBe("preserve this database");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
