import { backfillIntake } from "../src/server/intake/backfill";
import { prisma } from "../src/server/db";

/**
 * INTAKE-01 backfill: copies F-27 values of existing protocols into the protocol and the intake
 * where the protocol field is empty, and logs what was copied (also as intake.backfilled audit
 * events). Form copies are not changed. Safe to run again. `pnpm db:seed` runs it too.
 * Run: pnpm db:backfill-intake
 */
export async function runBackfill(): Promise<void> {
  const report = await backfillIntake();
  for (const entry of report) {
    const copied = Object.keys(entry.copied);
    console.log(`intake backfill ${entry.protocolId}: copied ${copied.length > 0 ? copied.join(", ") : "nothing"}`);
    for (const skip of entry.skipped) console.log(`  skipped ${skip.field}: ${skip.reason}`);
  }
  console.log(`intake backfill: ${report.length} protocol(s) logged`);
}

if (process.argv[1]?.endsWith("backfill-intake.ts")) {
  runBackfill()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
