import { prisma } from "@/server/db";
import { resetTestDatabase } from "@/server/test/reset-core";

/**
 * Truncates every application table in the current schema.
 * Only on a database named *_test or the schema recdms_test (see test-database.ts): never the
 * Supabase `recdms` schema or a shared `public`, so the test runner cannot wipe them.
 */
export async function resetDatabase(): Promise<void> {
  await resetTestDatabase(prisma);
}
