import "server-only";
import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // Two requests can overlap (a page still refreshing while the next one loads). On a small
    // pool the second one waits for a connection instead of failing after the default two seconds.
    transactionOptions: { maxWait: 20_000 },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

const schemaReady = new WeakSet<object>();

/** Report reads talk to a remote pooler, so the default five-second transaction is too short. */
export function readTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(run, { timeout: 20_000 });
}

/** Raw SQL is unqualified. Pin the transaction to the app schema (poolers reset search_path). */
export async function useAppSchema(tx: Prisma.TransactionClient): Promise<void> {
  if (schemaReady.has(tx)) return;
  const schema = new URL(process.env.DATABASE_URL ?? "postgres://localhost/postgres").searchParams.get(
    "schema",
  );
  if (schema === "recdms" || schema === "recdms_test") {
    await tx.$executeRaw`SELECT set_config('search_path', ${schema}, true)`;
  }
  schemaReady.add(tx);
}
