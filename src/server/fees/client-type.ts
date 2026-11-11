import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";

/**
 * The `fees.clientTypeRules` setting suggests a client type from the project leader's
 * affiliation: `[{ "clientTypeKey": "...", "when": { "profileKind": "USC_STUDENT", "academicLevel": "UNDERGRADUATE" } }]`.
 * The first rule whose every condition matches wins. REC Staff set the value.
 */
export async function suggestClientType(protocolId: string): Promise<string | null> {
  const [leader, rules] = await Promise.all([
    prisma.protocolMember.findFirst({
      where: { protocolId, isLeader: true },
      select: { profileKind: true, academicLevel: true, affiliationKind: true, institution: true, schoolName: true },
    }),
    settingValue(prisma, "fees.clientTypeRules"),
  ]);
  if (!leader || !Array.isArray(rules)) return null;
  const facts: Record<string, string | null> = {
    profileKind: leader.profileKind,
    academicLevel: leader.academicLevel,
    affiliationKind: leader.affiliationKind,
    institution: leader.institution,
    schoolName: leader.schoolName,
  };
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    const { clientTypeKey, when } = rule as { clientTypeKey?: unknown; when?: unknown };
    if (typeof clientTypeKey !== "string") continue;
    const conditions = when && typeof when === "object" && !Array.isArray(when) ? Object.entries(when as Record<string, unknown>) : [];
    if (conditions.every(([key, value]) => facts[key] === value)) return clientTypeKey;
  }
  return null;
}

export async function setClientType(input: { protocolId: string; clientTypeKey: string | null; actorUserId: string }) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const protocol = await tx.protocol.findUnique({ where: { id: input.protocolId }, select: { clientTypeKey: true } });
    if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
    if (input.clientTypeKey) {
      const type = await tx.clientType.findUnique({ where: { key: input.clientTypeKey } });
      if (!type?.active) throw new AppError("INVALID", "Choose an active client type.", 400);
    }
    await tx.protocol.update({ where: { id: input.protocolId }, data: { clientTypeKey: input.clientTypeKey } });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      actingRole: "REC_STAFF",
      action: AuditAction.clientTypeSet,
      entityType: "protocol",
      entityId: input.protocolId,
      protocolId: input.protocolId,
      diff: diffOf({ clientTypeKey: protocol.clientTypeKey }, { clientTypeKey: input.clientTypeKey }),
      meta,
    });
  });
}
