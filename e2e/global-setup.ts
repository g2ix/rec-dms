import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { resetTestDatabase } from "../src/server/test/reset-core";
import { loadTestEnv } from "./test-env";

/**
 * Migrates, empties and seeds the test database. `loadTestEnv` refuses a DATABASE_URL that is not a
 * test one; `resetTestDatabase` checks again on the database Postgres reports (the vitest guard).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: process.env });
  const prisma = new PrismaClient();
  try {
    await resetTestDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
  // The seed (panels, forms, workflows), run directly: `pnpm db:seed` loads .env.local.
  execSync("node --conditions=react-server --experimental-transform-types --import ./scripts/register-ts.mjs prisma/seed.ts", { stdio: "inherit", env: process.env });
}
