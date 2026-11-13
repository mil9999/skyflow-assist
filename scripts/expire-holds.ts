import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const { prisma } = await import("../src/server/db/prisma");
  try {
    const { expireDueHolds } = await import("../src/server/services/rebooking-service");
    const expired = await expireDueHolds();
    console.log(JSON.stringify({ expiredHolds: expired.length }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error("Hold expiry failed. Check the local database configuration and migrations.");
  process.exitCode = 1;
});
