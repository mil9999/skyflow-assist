/**
 * Runs before any test file is imported, so the Prisma client is constructed
 * against test.db rather than your development database.
 */
process.env.DATABASE_URL = `file:${process.cwd()}/prisma/test.db`;
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
