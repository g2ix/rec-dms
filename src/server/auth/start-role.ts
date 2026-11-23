import "server-only";
import { knownRoleView, type RoleView } from "@/lib/role-view";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { roleViewsOf } from "@/server/auth/view";

/**
 * The role the app opens in after sign-in. It is stored on each sign-in identity (every email
 * and linked Google account), which is what sign-in already reads, so all of them agree.
 * Null: open in the role used last.
 */
export async function startRoleOf(userId: string): Promise<RoleView | null> {
  const row = await prisma.userEmail.findFirst({
    where: { userId, defaultView: { not: null } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { defaultView: true },
  });
  return knownRoleView(row?.defaultView);
}

export async function setStartRole(userId: string, view: RoleView | null): Promise<void> {
  if (view) {
    const { views } = await roleViewsOf(userId);
    if (!views.includes(view)) throw new AppError("INVALID", "You do not hold that role.", 400);
  }
  await prisma.$transaction([
    prisma.userEmail.updateMany({ where: { userId }, data: { defaultView: view } }),
    prisma.account.updateMany({ where: { userId }, data: { defaultView: view } }),
  ]);
}
