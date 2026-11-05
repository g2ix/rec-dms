import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function listHolidays() {
  return prisma.holiday.findMany({ orderBy: { date: "asc" } });
}

export function holidayDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function saveHoliday(day: string, name: string, userId: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError("INVALID", "Enter the holiday as a date.", 400);
  const label = name.trim();
  if (!label) throw new AppError("INVALID", "Enter the holiday name.", 400);
  const date = new Date(`${day}T00:00:00.000Z`);
  const meta = await auditRequestMeta({ day });
  return prisma.$transaction(async (tx) => {
    const existing = await tx.holiday.findUnique({ where: { date } });
    const saved = existing
      ? await tx.holiday.update({ where: { id: existing.id }, data: { name: label } })
      : await tx.holiday.create({ data: { date, name: label } });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.holidaySaved,
      entityType: "holiday",
      entityId: saved.id,
      diff: diffOf(existing ? { name: existing.name } : {}, { date: day, name: label }),
      meta,
    });
    return saved;
  });
}

export async function removeHoliday(id: string, userId: string) {
  const existing = await prisma.holiday.findUnique({ where: { id } });
  if (!existing) throw new AppError("NOT_FOUND", "That holiday was not found.", 404);
  const meta = await auditRequestMeta({});
  await prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id } });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.holidaySaved,
      entityType: "holiday",
      entityId: id,
      diff: diffOf({ date: holidayDay(existing.date), name: existing.name }, { removed: true }),
      meta,
    });
  });
}
