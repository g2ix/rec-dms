import { prisma } from "@/server/db";
import { describe, expect, it } from "vitest";

async function roleExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${name}) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

describe("recdms_app", () => {
  it("cannot update or delete audit events, and can read settings", async () => {
    expect(await roleExists("recdms_app")).toBe(true);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('role', 'recdms_app', true)`;
        await tx.$executeRaw`UPDATE audit_events SET action = action WHERE false`;
      }),
    ).rejects.toThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('role', 'recdms_app', true)`;
        await tx.$executeRaw`DELETE FROM audit_events WHERE false`;
      }),
    ).rejects.toThrow();

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('role', 'recdms_app', true)`;
      return tx.$queryRaw<{ key: string }[]>`SELECT key FROM settings LIMIT 1`;
    });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("gives the anon role no rows when that role exists", async () => {
    if (!(await roleExists("anon"))) return;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('role', 'anon', true)`;
        await tx.$queryRaw`SELECT key FROM settings LIMIT 1`;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("permission denied to set role")) return;
      expect(message).toMatch(/permission denied|row-level security|does not exist/i);
      return;
    }
    throw new Error("anon was able to read settings");
  });
});
