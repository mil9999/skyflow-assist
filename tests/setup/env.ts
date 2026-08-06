/**
 * Runs before any test file is imported, so the Prisma client is constructed
 * against test.db rather than your development database.
 */
process.env.DATABASE_URL = `file:${process.cwd()}/prisma/test.db`;

/** Not a real secret — the routes only need *a* key to compare against. */
process.env.TOOLS_API_KEY = "test-tools-api-key";
