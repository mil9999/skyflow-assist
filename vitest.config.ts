import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" path in tsconfig.json so tests can import route handlers.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Migrates a fresh temporary database once per run and removes it afterward.
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Injects the temporary database URL before any test imports Prisma.
    setupFiles: ["./tests/setup/env.ts"],
    // SQLite is a single file; parallel workers would fight over it.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
