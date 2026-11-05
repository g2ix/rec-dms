import { beforeAll } from "vitest";

beforeAll(async () => {
  if (!process.env.DATABASE_URL) return;
  const { resetDatabase } = await import("./src/server/test/reset-db");
  await resetDatabase();
});
