import "server-only";
import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/** Raw SQL is unqualified. Pin the transaction to the app schema (poolers reset search_path). */
export async function useAppSchema(tx: Prisma.TransactionClient): Promise<void> {
  const schema = new URL(process.env.DATABASE_URL ?? "postgres://localhost/postgres").searchParams.get(
    "schema",
  );
  if (schema === "recdms" || schema === "recdms_test") {
    await tx.$executeRaw`SELECT set_config('search_path', ${schema}, true)`;
  }
}
