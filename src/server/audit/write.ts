import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { recordAuditEvent, type AuditInput } from "@/server/audit/chain";
import { auditRequestMeta } from "@/server/audit/context";

function metaRecord(meta: AuditInput["meta"]): Record<string, Prisma.InputJsonValue | null> {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta as Record<string, Prisma.InputJsonValue | null>;
}

export async function recordAudit(input: AuditInput, headerList?: Headers) {
  const meta = await auditRequestMeta(metaRecord(input.meta), headerList);
  return prisma.$transaction((tx) => recordAuditEvent(tx, { ...input, meta }));
}
