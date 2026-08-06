import { execSync } from "node:child_process";

/** Builds a throwaway database from the current schema, once per test run. */
export default function setup() {
  const url = `file:${process.cwd()}/prisma/test.db`;

  execSync("npx prisma db push --force-reset --accept-data-loss --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
