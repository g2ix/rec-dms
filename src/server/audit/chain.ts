import type { Prisma } from "@prisma/client";
import { AUDIT_GENESIS, hashAudit, secondPrecision, type AuditBody } from "./hash";

export type AuditInput = {
  occurredAt?: Date;
  actorUserId?: string | null;
  actingRole?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  protocolId?: string | null;
  diff?: Prisma.InputJsonValue;
  meta?: Prisma.InputJsonValue;
};

export type ChainRange = {
  fromSeq?: bigint | number;
  toSeq?: bigint | number;
};

export type ChainVerification = { ok: true; seq: bigint | null } | { ok: false; seq: bigint };

type AuditReader = {
  auditEvent: {
    findFirst: Prisma.TransactionClient["auditEvent"]["findFirst"];
    findMany: Prisma.TransactionClient["auditEvent"]["findMany"];
  };
};

function bodyOf(input: AuditInput, occurredAt: Date): AuditBody {
  return {
    action: input.action,
    actorUserId: input.actorUserId ?? null,
    actingRole: input.actingRole ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    protocolId: input.protocolId ?? null,
    diff: input.diff ?? {},
    meta: input.meta ?? {},
    occurredAt: occurredAt.toISOString(),
  };
}

export async function recordAuditEvent(tx: Prisma.TransactionClient, input: AuditInput) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(2142041, 1)`;
  const previous = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" } });
  const prevHash = previous?.hash ?? AUDIT_GENESIS;
  const occurredAt = secondPrecision(input.occurredAt ?? new Date());
  const body = bodyOf(input, occurredAt);
  const hash = hashAudit(prevHash, body);
  return tx.auditEvent.create({
    data: {
      occurredAt,
      actorUserId: body.actorUserId,
      actingRole: body.actingRole,
      action: body.action,
      entityType: body.entityType,
      entityId: body.entityId,
      protocolId: body.protocolId,
      diff: body.diff as Prisma.InputJsonValue,
      meta: body.meta as Prisma.InputJsonValue,
      prevHash,
      hash,
    },
  });
}

export async function verifyAuditChain(db: AuditReader, range?: ChainRange): Promise<ChainVerification> {
  const seq: Prisma.BigIntFilter = {};
  if (range?.fromSeq !== undefined) seq.gte = BigInt(range.fromSeq);
  if (range?.toSeq !== undefined) seq.lte = BigInt(range.toSeq);

  let prevHash: string = AUDIT_GENESIS;
  if (range?.fromSeq !== undefined) {
    const previous = await db.auditEvent.findFirst({
      where: { seq: { lt: BigInt(range.fromSeq) } },
      orderBy: { seq: "desc" },
    });
    prevHash = previous?.hash ?? AUDIT_GENESIS;
  }

  const rows = await db.auditEvent.findMany({
    where: Object.keys(seq).length > 0 ? { seq } : undefined,
    orderBy: { seq: "asc" },
  });

  let last: bigint | null = null;
  for (const row of rows) {
    const body: AuditBody = {
      action: row.action,
      actorUserId: row.actorUserId,
      actingRole: row.actingRole,
      entityType: row.entityType,
      entityId: row.entityId,
      protocolId: row.protocolId,
      diff: row.diff,
      meta: row.meta,
      occurredAt: secondPrecision(row.occurredAt).toISOString(),
    };
    const hash = hashAudit(prevHash, body);
    if (hash !== row.hash || row.prevHash !== prevHash) {
      return { ok: false, seq: row.seq };
    }
    prevHash = row.hash;
    last = row.seq;
  }
  return { ok: true, seq: last };
}
