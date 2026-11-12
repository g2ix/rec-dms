import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { matchClientType, parseClientTypeRules, type ClientTypeFacts } from "@/lib/fees/client-type";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** `fees.clientTypeFunds`: the form and field whose answer is the `funds` fact, e.g. { "code": "...", "field": "funds" }. */
async function fundsSource(db: Db): Promise<{ code: string; field: string } | null> {
  const value = await settingValue(db, "fees.clientTypeFunds");
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const { code, field } = value as { code?: unknown; field?: unknown };
    if (typeof code === "string" && typeof field === "string") return { code, field };
  }
  return null;
}

/** What the rules can read about a protocol: the leader's affiliation and the application form. */
export async function clientTypeFacts(db: Db, protocolId: string): Promise<ClientTypeFacts | null> {
  const leader = await db.protocolMember.findFirst({
    where: { protocolId, isLeader: true },
    select: {
      profileKind: true,
      academicLevel: true,
      affiliationKind: true,
      institution: true,
      schoolName: true,
      departmentName: true,
      officeName: true,
      programName: true,
      course: true,
      position: true,
    },
  });
  if (!leader) return null;
  const source = await fundsSource(db);
  const versions = await db.protocolVersion.findMany({ where: { protocolId }, select: { id: true } });
  const application = !source ? null : await db.formInstance.findFirst({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: { in: versions.map((version) => version.id) }, filledByMemberId: null, formDefinition: { code: source.code } },
    orderBy: { updatedAt: "desc" },
    select: { data: true },
  });
  const data = application?.data && typeof application.data === "object" && !Array.isArray(application.data) ? (application.data as Record<string, unknown>) : {};
  const rawFunds = source ? data[source.field] : undefined;
  const formFunds = Array.isArray(rawFunds) ? rawFunds.filter((item): item is string => typeof item === "string") : typeof rawFunds === "string" ? [rawFunds] : [];
  // Intake versions keep the source of funds on the protocol (Details), not on the application form.
  const funds = formFunds.length > 0 ? formFunds : await protocolFunds(db, protocolId);
  return { ...leader, academicLevel: leader.academicLevel ?? null, affiliationKind: leader.affiliationKind ?? null, funds };
}

async function protocolFunds(db: Db, protocolId: string): Promise<string[]> {
  const protocol = await db.protocol.findUnique({ where: { id: protocolId }, select: { fundingSources: true } });
  const sources = Array.isArray(protocol?.fundingSources) ? protocol.fundingSources : [];
  return sources.flatMap((item) =>
    item && typeof item === "object" && !Array.isArray(item) && typeof (item as { code?: unknown }).code === "string" ? [(item as { code: string }).code] : [],
  );
}

/**
 * The `fees.clientTypeRules` setting suggests a client type from the project leader's affiliation
 * and the source of funds (see `@/lib/fees/client-type`). REC Staff can always change it.
 */
export async function suggestClientType(protocolId: string, db: Db = prisma): Promise<string | null> {
  const [facts, rules] = await Promise.all([clientTypeFacts(db, protocolId), settingValue(db, "fees.clientTypeRules")]);
  if (!facts) return null;
  const key = matchClientType(parseClientTypeRules(rules), facts);
  if (!key) return null;
  const type = await db.clientType.findUnique({ where: { key } });
  return type?.active ? key : null;
}

/**
 * Sets the suggested client type on a protocol that has none, as the system. Called when the
 * protocol is submitted and before a bill is priced; a type REC Staff chose is never replaced.
 */
export async function applySuggestedClientType(tx: Tx, protocolId: string, meta: Prisma.InputJsonObject): Promise<string | null> {
  const protocol = await tx.protocol.findUnique({ where: { id: protocolId }, select: { clientTypeKey: true } });
  if (!protocol || protocol.clientTypeKey) return protocol?.clientTypeKey ?? null;
  const key = await suggestClientType(protocolId, tx);
  if (!key) return null;
  await tx.protocol.update({ where: { id: protocolId }, data: { clientTypeKey: key } });
  await audit.record(tx, {
    actorUserId: null,
    action: AuditAction.clientTypeSet,
    entityType: "protocol",
    entityId: protocolId,
    protocolId,
    diff: diffOf({ clientTypeKey: null }, { clientTypeKey: key, suggested: true }),
    meta,
  });
  return key;
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
