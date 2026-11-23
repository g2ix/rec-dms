import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setStartRole, startRoleOf } from "@/server/auth/start-role";
import { makeUser } from "@/server/test/users";

async function person() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return makeUser({ email: `start.${suffix}@usc.edu.ph`, familyName: `Start${suffix}` });
}

async function grant(userId: string, key: string) {
  const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, scope: "GLOBAL" } });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

describe("start role", () => {
  it("saves the role on every sign-in email and reads it back", async () => {
    const user = await person();
    await grant(user.id, "REC_STAFF");
    await prisma.userEmail.create({ data: { userId: user.id, email: `second.${user.id.slice(0, 8)}@example.com` } });
    await setStartRole(user.id, "staff");
    const rows = await prisma.userEmail.findMany({ where: { userId: user.id }, select: { defaultView: true } });
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.defaultView === "staff")).toBe(true);
    expect(await startRoleOf(user.id)).toBe("staff");
  });

  it("clears back to the last used role", async () => {
    const user = await person();
    await setStartRole(user.id, "proponent");
    await setStartRole(user.id, null);
    expect(await startRoleOf(user.id)).toBeNull();
  });

  it("refuses a role the person does not hold", async () => {
    const user = await person();
    await expect(setStartRole(user.id, "chair")).rejects.toMatchObject({ code: "INVALID" });
  });
});
