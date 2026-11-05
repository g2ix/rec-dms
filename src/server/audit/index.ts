import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

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

type AuditBody = {
  action: string;
  actorUserId: string | null;
  actingRole: string | null;
  entityType: string;
  entityId: string;
  protocolId: string | null;
  diff: unknown;
  meta: unknown;
  occurredAt: string;
};

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function hashAudit(prevHash: string, body: AuditBody): string {
  return createHash("sha256").update(prevHash + canonicalJson(body)).digest("hex");
}

function secondPrecision(date: Date): Date {
  const copy = new Date(date);
  copy.setMilliseconds(0);
  return copy;
}

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

export const audit = {
  async record(tx: Prisma.TransactionClient, input: AuditInput) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(2142041, 1)`;
    const previous = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" } });
    const prevHash = previous?.hash ?? "GENESIS";
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
  },

  async verifyChain(tx: Prisma.TransactionClient | { auditEvent: Prisma.TransactionClient["auditEvent"] }) {
    const rows = await tx.auditEvent.findMany({ orderBy: { seq: "asc" } });
    let prevHash = "GENESIS";
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
        return { ok: false as const, seq: row.seq };
      }
      prevHash = row.hash;
    }
    return { ok: true as const, seq: rows.at(-1)?.seq ?? null };
  },
};
