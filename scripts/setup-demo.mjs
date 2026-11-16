import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
if (!existsSync(envPath)) {
  const template = readFileSync(resolve(root, ".env.example"), "utf8")
    .replace('TOOLS_API_KEY=""', `TOOLS_API_KEY="${randomBytes(32).toString("hex")}"`)
    .replace('TEXT_AGENT_PROVIDER="openai"', 'TEXT_AGENT_PROVIDER="fake"')
    .replace('ALLOW_DEMO_RESET="false"', 'ALLOW_DEMO_RESET="true"');
  writeFileSync(envPath, template, { flag: "wx", mode: 0o600 });
  console.log("Created a local .env for the fictional, offline demo.");
}

const configuredUrl = readFileSync(envPath, "utf8")
  .match(/^DATABASE_URL\s*=\s*(.+)$/m)?.[1]
  .trim()
  .replace(/^["']|["']$/g, "");
if ((process.env.DATABASE_URL || configuredUrl) !== "file:./dev.db") {
  throw new Error("setup:demo requires DATABASE_URL=file:./dev.db. Other databases are left untouched.");
}

const database = resolve(root, "prisma/dev.db");
const alreadyExists = existsSync(database);
if (!alreadyExists) writeFileSync(database, "", { flag: "wx", mode: 0o600 });
const runPrisma = (...args) => execFileSync(
  process.execPath,
  [resolve(root, "node_modules/prisma/build/index.js"), ...args],
  { cwd: root, stdio: "inherit", env: { ...process.env, DATABASE_URL: "file:./dev.db" } },
);

runPrisma("generate");
runPrisma("migrate", "deploy");
// An interrupted first setup may have created the schema without seeding it.
// Resume only if there is no application data; never overwrite an existing demo.
const { PrismaClient } = await import("@prisma/client");
const client = new PrismaClient({ datasourceUrl: `file:${database}` });
let hasData;
try {
  const counts = await Promise.all([
    client.passenger.count(), client.flight.count(), client.booking.count(), client.conversationSession.count(),
  ]);
  hasData = counts.some((count) => count > 0);
} finally {
  await client.$disconnect();
}
if (!hasData) {
  runPrisma("db", "seed");
} else {
  console.log("Preserved the existing demo data. Use Reset demo in the simulator to refresh it.");
}
console.log("Ready. Run npm run dev, then open http://localhost:3000/simulator.");
console.log("The scripted scenarios exercise the real backend without making AI API calls.");
