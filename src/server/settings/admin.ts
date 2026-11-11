import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

const KEY = /^[a-z][A-Za-z0-9_]*(\.[a-z][A-Za-z0-9_]*)+$/;

/** Settings that drive the process. Each row is JSON; a scheduled value takes effect on its date. */
export async function listSettings() {
  const [rows, scheduled] = await Promise.all([
    prisma.setting.findMany({ orderBy: { key: "asc" } }),
    prisma.settingSchedule.findMany({ where: { appliedAt: null, cancelledAt: null }, orderBy: { effectiveFrom: "asc" } }),
  ]);
  return { rows, scheduled };
}

function parseValue(text: string): Prisma.InputJsonValue {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || value === undefined) throw new Error("empty");
    return value as Prisma.InputJsonValue;
  } catch {
    throw new AppError("INVALID", "The value must be valid JSON, such as \"text\", 30, or an object.", 400);
  }
}

export async function saveSetting(input: { key: string; valueText: string; effectiveFrom: Date | null; actorUserId: string }) {
  const key = input.key.trim();
  if (!KEY.test(key)) throw new AppError("INVALID", "Use a dotted key such as meetings.schedule.", 400);
  const value = parseValue(input.valueText);
  const meta = await auditRequestMeta({ key });
  const scheduled = input.effectiveFrom && input.effectiveFrom.getTime() > Date.now() ? input.effectiveFrom : null;
  return prisma.$transaction(async (tx) => {
    if (scheduled) {
      const row = await tx.settingSchedule.create({ data: { key, value, effectiveFrom: scheduled, createdById: input.actorUserId } });
      await audit.record(tx, {
        actorUserId: input.actorUserId,
        action: AuditAction.settingScheduled,
        entityType: "setting",
        entityId: key,
        diff: { value, effectiveFrom: scheduled.toISOString(), scheduleId: row.id },
        meta,
      });
      return;
    }
    const before = await tx.setting.findUnique({ where: { key } });
    await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.settingChanged,
      entityType: "setting",
      entityId: key,
      diff: diffOf({ value: (before?.value ?? null) as Prisma.InputJsonValue }, { value }),
      meta,
    });
  });
}

export async function cancelScheduledSetting(id: string, actorUserId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const row = await tx.settingSchedule.findUnique({ where: { id } });
    if (!row || row.appliedAt || row.cancelledAt) throw new AppError("NOT_FOUND", "That scheduled value was not found.", 404);
    if (row.effectiveFrom.getTime() <= Date.now()) throw new AppError("LOCKED", "That value has already taken effect.", 409);
    await tx.settingSchedule.update({ where: { id }, data: { cancelledAt: new Date() } });
    await audit.record(tx, {
      actorUserId,
      action: AuditAction.settingChanged,
      entityType: "setting",
      entityId: row.key,
      diff: { cancelledSchedule: id, effectiveFrom: row.effectiveFrom.toISOString() },
      meta,
    });
  });
}
