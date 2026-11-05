import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const hasDatabase = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

describe.skipIf(!hasDatabase)("resetDatabase", () => {
  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy", {
      stdio: "inherit",
      env: process.env,
    });
  }, 60_000);

  it("removes rows written during the test", async () => {
    const { prisma } = await import("@/server/db");
    const { resetDatabase } = await import("@/server/test/reset-db");

    await prisma.setting.create({
      data: { key: "test.example", value: { ok: true } },
    });
    expect(await prisma.setting.count()).toBe(1);

    await resetDatabase();
    expect(await prisma.setting.count()).toBe(0);
  });
});
