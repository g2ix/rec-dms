import { PrismaClient } from "@prisma/client";
import { clearLoad, insertLoad } from "../src/lib/reports/load-data";
import { dashboardIn } from "../src/server/reports/dashboard";
import { useAppSchema } from "../src/server/db";

const prisma = new PrismaClient();

async function main() {
  if (process.env.LOAD_SEED === "delete") {
    await clearLoad(prisma);
    console.log("Removed the load-test protocols.");
    return;
  }
  if (process.env.LOAD_SEED !== "1") {
    console.error("Set LOAD_SEED=1 to insert 5,000 protocols, or LOAD_SEED=delete to remove them.");
    process.exitCode = 1;
    return;
  }
  await clearLoad(prisma);
  const { userId } = await insertLoad(prisma, 5000);
  const staffMs = await time(userId, "staff");
  const chairMs = await time(userId, "chair");
  console.log(`Staff dashboard ${staffMs.toFixed(0)} ms, chair dashboard ${chairMs.toFixed(0)} ms.`);
  if (staffMs >= 1000 || chairMs >= 1000) process.exitCode = 1;
}

async function time(userId: string, view: "staff" | "chair") {
  const started = performance.now();
  await prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    await dashboardIn(tx, userId, view);
  });
  return performance.now() - started;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
