import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json so tests can import route handlers.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Creates prisma/test.db and pushes the schema into it once per run.
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Points the Prisma client at that file before any test imports it.
    setupFiles: ["./tests/setup/env.ts"],
    // SQLite is a single file; parallel workers would fight over it.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
