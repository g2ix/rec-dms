import "server-only";
import { knownRoleView, viewsForRoleKeys, type RoleView } from "@/lib/role-view";
import { prisma } from "@/server/db";

export async function resolveRoleView(
  userId: string,
  cookieValue: string | null | undefined,
): Promise<{ view: RoleView; views: RoleView[] }> {
  const grants = await prisma.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } } },
  });
  const granted = viewsForRoleKeys(grants.map((grant) => grant.role.key));
  const requested = knownRoleView(cookieValue);
  const views = granted.length > 0 ? granted : [requested ?? "proponent"];
  const view = requested && views.includes(requested) ? requested : views[0]!;
  return { view, views };
}
