import "server-only";
import type { Prisma } from "@prisma/client";
import { isBootstrapAdmin } from "@/server/auth/bootstrap";
import { AppError } from "@/server/errors";

const SECRETARIAT = new Set(["REC_STAFF", "REC_CHAIR", "SYSTEM_ADMIN", "MEMBER_SECRETARY"]);

export type ReportScope = { kind: "all" } | { kind: "panels"; panelIds: string[] };

export async function reportScope(tx: Prisma.TransactionClient, userId: string): Promise<ReportScope> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { panelId: true, role: { select: { key: true } } },
  });
  const keys = new Set(grants.map((grant) => grant.role.key));
  if (await isBootstrapAdmin(userId, tx)) keys.add("SYSTEM_ADMIN");
  if ([...keys].some((key) => SECRETARIAT.has(key))) return { kind: "all" };
  const panelIds = [...new Set(grants.flatMap((grant) => (grant.role.key === "PANEL_CHAIR" && grant.panelId ? [grant.panelId] : [])))];
  if (panelIds.length === 0) {
    throw new AppError("FORBIDDEN", "Reports are for REC Staff, Chairs, and administrators.", 403);
  }
  return { kind: "panels", panelIds };
}

/** A panel chair stays inside their panels even if the query names another panel. */
export function constrainPanel(scope: ReportScope, requested: string | undefined): string | { in: string[] } | undefined {
  if (scope.kind === "all") return requested || undefined;
  if (requested && !scope.panelIds.includes(requested)) {
    throw new AppError("FORBIDDEN", "You can only export your own panel.", 403);
  }
  return requested || { in: scope.panelIds };
}

export async function secretariatOrThrow(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const scope = await reportScope(tx, userId);
  if (scope.kind !== "all") throw new AppError("FORBIDDEN", "That queue is for REC Staff.", 403);
}
