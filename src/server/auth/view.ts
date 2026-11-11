import "server-only";
import { baseViews, knownRoleView, ROLE_VIEWS, viewsForRoleKeys, type RoleView } from "@/lib/role-view";
import { prisma } from "@/server/db";

export async function resolveRoleView(
  userId: string,
  cookieValue: string | null | undefined,
): Promise<{ view: RoleView; views: RoleView[] }> {
  const [grants, emails, advising] = await Promise.all([
    prisma.userRole.findMany({
      where: { userId, revokedAt: null },
      select: { role: { select: { key: true } } },
    }),
    prisma.userEmail.findMany({ where: { userId, verifiedAt: { not: null } }, select: { email: true } }),
    prisma.protocolMember.findFirst({ where: { userId, role: "ADVISER", status: "ACTIVE" }, select: { id: true } }),
  ]);
  const granted = viewsForRoleKeys(grants.map((grant) => grant.role.key));
  const base = baseViews({ emails: emails.map((row) => row.email), advisesAProtocol: Boolean(advising) });
  const unlocked = new Set<RoleView>([...base, ...granted]);
  const views = ROLE_VIEWS.filter((view) => unlocked.has(view));
  const requested = knownRoleView(cookieValue);
  const view = requested && views.includes(requested) ? requested : (granted[0] ?? views[0]!);
  return { view, views };
}
