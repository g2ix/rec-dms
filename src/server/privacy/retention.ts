import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";
import { audit, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { recordNotice } from "@/server/notifications/deliver";

const DEFAULT_YEARS = 3;
const DEFAULT_CLOSED = ["Approved", "Exempted", "Disapproved", "Lapsed", "Withdrawn"];

type Policy = { years: number; closedStatuses: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function retentionPolicy(): Promise<Policy> {
  const row = await prisma.setting.findUnique({ where: { key: "retention.policy" } });
  const value = row?.value;
  if (!isRecord(value)) return { years: DEFAULT_YEARS, closedStatuses: DEFAULT_CLOSED };
  const years = typeof value.years === "number" && value.years > 0 ? value.years : DEFAULT_YEARS;
  const closedStatuses = Array.isArray(value.closedStatuses)
    ? value.closedStatuses.filter((item): item is string => typeof item === "string" && item.length > 0)
    : DEFAULT_CLOSED;
  return { years, closedStatuses: closedStatuses.length > 0 ? closedStatuses : DEFAULT_CLOSED };
}

/** Flag a bounded batch of closed protocols. Nothing is deleted. */
export async function flagRetention(now = new Date(), limit = 50): Promise<{ flagged: number }> {
  const policy = await retentionPolicy();
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - policy.years);
  const rows = await prisma.protocol.findMany({
    where: {
      status: { in: policy.closedStatuses },
      retentionFlaggedAt: null,
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, code: true, title: true, status: true },
  });
  if (rows.length === 0) return { flagged: 0 };
  const staff = await recStaffIds();
  await prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    for (const row of rows) {
      await tx.protocol.update({ where: { id: row.id }, data: { retentionFlaggedAt: now } });
      await audit.record(tx, {
        action: AuditAction.retentionFlagged,
        entityType: "protocol",
        entityId: row.id,
        protocolId: row.id,
        diff: diffOf({}, { status: row.status, code: row.code }),
        meta: { years: policy.years },
      });
    }
    if (staff.length > 0) {
      await recordNotice(tx, {
        userIds: staff,
        templateKey: "retention.flagged",
        link: "/admin/retention",
        variables: { reason: String(rows.length) },
      });
    }
  });
  return { flagged: rows.length };
}

async function recStaffIds(): Promise<string[]> {
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { key: "REC_STAFF" } },
    select: { userId: true },
  });
  const emails = bootstrapAdminEmails();
  const bootstrap = emails.length
    ? await prisma.userEmail.findMany({
        where: { email: { in: emails }, verifiedAt: { not: null } },
        select: { userId: true },
      })
    : [];
  return [...new Set([...grants.map((grant) => grant.userId), ...bootstrap.map((row) => row.userId)])];
}
