import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { attentionByRole } from "@/server/notifications/attention";
import { makeUser } from "@/server/test/users";

async function person() {
  const suffix = crypto.randomUUID().slice(0, 8);
  return makeUser({ email: `notice.${suffix}@usc.edu.ph`, familyName: `Notice${suffix}` });
}

function notice(userId: string, roleView: string | null, read = false) {
  return prisma.notification.create({
    data: { userId, type: "test", title: "Test", roleView, readAt: read ? new Date() : null },
  });
}

beforeEach(async () => {
  await prisma.notification.deleteMany();
});

describe("attentionByRole", () => {
  it("counts unread notices under each role and keeps account notices apart", async () => {
    const user = await person();
    await notice(user.id, "proponent");
    await notice(user.id, "proponent");
    await notice(user.id, "reviewer");
    await notice(user.id, "reviewer", true);
    await notice(user.id, null);
    const attention = await attentionByRole(user.id, ["proponent", "reviewer"]);
    expect(attention.roles).toEqual([
      { view: "proponent", unread: 2, tasks: 0 },
      { view: "reviewer", unread: 1, tasks: 0 },
    ]);
    expect(attention.accountUnread).toBe(1);
    expect(attention.totalUnread).toBe(4);
  });

  it("counts a notice for a role the person no longer holds under the account", async () => {
    const user = await person();
    await notice(user.id, "staff");
    const attention = await attentionByRole(user.id, ["proponent"]);
    expect(attention.roles).toEqual([{ view: "proponent", unread: 0, tasks: 0 }]);
    expect(attention.accountUnread).toBe(1);
  });
});
