import "server-only";
import { isBootstrapAdmin } from "@/server/auth/bootstrap";
import { prisma } from "@/server/db";

export const STAFF_KEYS = ["REC_STAFF", "REC_CHAIR", "PANEL_CHAIR", "PANEL_VICE_CHAIR", "PANEL_SECRETARY", "SYSTEM_ADMIN"] as const;

/** Committee staff until M02 role grants are the only check. Bootstrap admins count as staff. */
export async function isCommitteeStaff(userId: string): Promise<boolean> {
  if (await isBootstrapAdmin(userId)) return true;
  const grant = await prisma.userRole.findFirst({
    where: { userId, revokedAt: null, role: { key: { in: [...STAFF_KEYS] } } },
    select: { id: true },
  });
  return Boolean(grant);
}
