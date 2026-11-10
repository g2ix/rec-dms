import type { PrismaClient, RoleScope } from "@prisma/client";

/**
 * The role list in docs/SPEC.md. Primary Reviewer and Independent Consultant are GLOBAL here:
 * a workflow step offers everyone holding the role, and the choice for one protocol is made on that step.
 */
const ROLES: { key: string; name: string; scope: RoleScope }[] = [
  { key: "PROPONENT", name: "Proponent", scope: "PROTOCOL" },
  { key: "PROJECT_LEADER", name: "Project Leader", scope: "PROTOCOL" },
  { key: "ADVISER", name: "Adviser", scope: "PROTOCOL" },
  { key: "REC_STAFF", name: "REC Staff", scope: "GLOBAL" },
  { key: "REC_CHAIR", name: "REC Chair", scope: "GLOBAL" },
  { key: "PANEL_CHAIR", name: "Panel Chair", scope: "PANEL" },
  { key: "PRIMARY_REVIEWER", name: "Primary Reviewer", scope: "GLOBAL" },
  { key: "INDEPENDENT_CONSULTANT", name: "Independent Consultant", scope: "GLOBAL" },
  { key: "REC_MEMBER", name: "REC Member", scope: "GLOBAL" },
  { key: "MEMBER_SECRETARY", name: "Member Secretary", scope: "GLOBAL" },
  { key: "SYSTEM_ADMIN", name: "System Admin", scope: "GLOBAL" },
];

export async function installRoles(prisma: PrismaClient): Promise<void> {
  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { key: role.key },
      create: role,
      update: { name: role.name, scope: role.scope },
    });
  }
}
