import { PrismaClient } from "@prisma/client";
import { verifyAuditChain } from "../src/server/audit/chain";

const prisma = new PrismaClient();

try {
  const result = await verifyAuditChain(prisma);
  if (!result.ok) {
    console.error(`Chain broken at #${result.seq.toString()}`);
    process.exitCode = 1;
  } else {
    const seq = result.seq === null ? "0" : result.seq.toString();
    console.log(`Chain verified up to #${seq}`);
  }
} finally {
  await prisma.$disconnect();
}
