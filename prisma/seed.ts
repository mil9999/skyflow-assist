/**
 * SkyFlow Airlines - fictional seed data.
 * All passengers, flights and bookings are invented. No real personal data.
 *
 * The scenario itself lives in src/server/demo/scenario.ts so that this script
 * and the simulator's "reset demo data" button can never drift apart.
 *
 * Run: npm run seed
 */
import { prisma } from "../src/server/db/prisma";
import { resetDemoScenario } from "../src/server/demo/scenario";

async function main() {
  const summary = await resetDemoScenario();

  console.log("Seeded SkyFlow Airlines:");
  console.log(`  ${summary.passengers} passengers, ${summary.flights} flights`);
  console.log("  Scenario A  SKY82Q / Martin  -> SF204 cancelled, alternatives SF218, SF224, SF310");
  console.log("  Scenario B  SKY55T / Okafor  -> SF640 cancelled, no eligible alternative");
  console.log("  Scenario C  SKY82Q / Dubois  -> surname mismatch, verification must fail");
  console.log("  Decoys: SF228 (no seats), SF644 (full), SF648 (cancelled)");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
