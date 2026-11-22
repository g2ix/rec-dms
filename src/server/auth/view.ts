import "server-only";
import { baseViews, knownRoleView, ROLE_VIEWS, viewsForRoleKeys, type RoleView } from "@/lib/role-view";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

type Db = Pick<Prisma.TransactionClient, "userRole" | "userEmail" | "protocolMember">;

/** Every role view the account can switch to, in switcher order, and the granted ones. */
export async function roleViewsOf(userId: string, db: Db = prisma): Promise<{ views: RoleView[]; granted: RoleView[] }> {
  const [grants, emails, advising] = await Promise.all([
    db.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: { select: { key: true } } },
    }),
    db.userEmail.findMany({ where: { userId, verifiedAt: { not: null } }, select: { email: true } }),
    db.protocolMember.findFirst({ where: { userId, role: "ADVISER", status: "ACTIVE" }, select: { id: true } }),
  ]);
  const granted = viewsForRoleKeys(grants.map((grant) => grant.role.key));
  const base = baseViews({ emails: emails.map((row) => row.email), advisesAProtocol: Boolean(advising) });
  const unlocked = new Set<RoleView>([...base, ...granted]);
  const views = ROLE_VIEWS.filter((view) => unlocked.has(view));
  return { views, granted };
}

export async function resolveRoleView(
  userId: string,
  cookieValue: string | null | undefined,
): Promise<{ view: RoleView; views: RoleView[] }> {
  const { views, granted } = await roleViewsOf(userId);
  const requested = knownRoleView(cookieValue);
  const view = requested && views.includes(requested) ? requested : (granted[0] ?? views[0]!);
  return { view, views };
}
