import { PrismaClient, type Prisma } from "@prisma/client";

// Next.js reloads modules in development, which would otherwise open a new
// database connection on every save. Keep one client on the global object.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Every repository takes one of these. Passing the transaction client through
 * is what stops a single write from escaping the surrounding $transaction.
 */
export type DatabaseClient = PrismaClient | Prisma.TransactionClient;
