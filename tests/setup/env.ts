import { inject } from "vitest";

// Global setup owns this new temporary database; an inherited DATABASE_URL can
// never direct a test's fixture cleanup at the developer's database.
process.env.DATABASE_URL = inject("testDatabaseUrl");

/** Not a real secret — the routes only need *a* key to compare against. */
process.env.TOOLS_API_KEY = "test-tools-api-key";
