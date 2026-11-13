import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestProject } from "vitest/node";

/** Applies real migrations to a new database, without resetting existing data. */
export default function setup(project: TestProject) {
  const directory = mkdtempSync(join(tmpdir(), "skyflow-tests-"));
  const database = join(directory, "test.db");
  const url = `file:${database}`;
  writeFileSync(database, "");

  try {
    execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: url },
    });
    project.provide("testDatabaseUrl", url);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return () => rmSync(directory, { recursive: true, force: true });
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
