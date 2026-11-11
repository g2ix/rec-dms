import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { FEE_BASES, isFeeBasis, quoteFee, scheduleOn, type FeeBasisKey } from "@/lib/fees/calc";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { loadSchedules } from "@/server/fees/bills";

export type ScheduleInput = {
  id?: string | null;
  effectiveFrom: string;
  approvedRef: string;
  notes: string;
  rates: { clientTypeKey: string; basis: FeeBasisKey; amount: number }[];
  rules: { key: string; label: string; percent: number; fromRound: number | null }[];
};

export async function listFeeAdmin() {
  const [types, schedules] = await Promise.all([
    prisma.clientType.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.feeSchedule.findMany({
      orderBy: { effectiveFrom: "desc" },
      include: { rates: true, rules: true, _count: { select: { bills: true } } },
    }),
  ]);
  return { types, schedules };
}

export async function saveClientType(input: { key: string; label: string; active: boolean; sortOrder: number; actorUserId: string }) {
  const key = input.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  if (!key || !input.label.trim()) throw new AppError("INVALID", "Give the client type a key and a label.", 400);
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const before = await tx.clientType.findUnique({ where: { key } });
    const row = await tx.clientType.upsert({
      where: { key },
      create: { key, label: input.label.trim(), active: input.active, sortOrder: input.sortOrder },
      update: { label: input.label.trim(), active: input.active, sortOrder: input.sortOrder },
    });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.feeScheduleSaved,
      entityType: "client_type",
      entityId: key,
      diff: diffOf(before ? { label: before.label, active: before.active } : {}, { label: row.label, active: row.active }),
      meta,
    });
    return row;
  });
}

function validate(input: ScheduleInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new AppError("INVALID", "Enter the date the schedule takes effect.", 400);
  for (const rate of input.rates) {
    if (!isFeeBasis(rate.basis)) throw new AppError("INVALID", "A rate has an unknown basis.", 400);
    if (!Number.isInteger(rate.amount) || rate.amount < 0) throw new AppError("INVALID", "Each amount must be zero or more.", 400);
  }
  for (const rule of input.rules) {
    if (!rule.key.trim()) throw new AppError("INVALID", "Each rule needs a key.", 400);
    if (!Number.isInteger(rule.percent) || rule.percent < 0 || rule.percent > 1000) throw new AppError("INVALID", "Each rule needs a percent.", 400);
    if (rule.fromRound != null && (!Number.isInteger(rule.fromRound) || rule.fromRound < 1)) throw new AppError("INVALID", "A rule's first round must be 1 or more.", 400);
  }
}

/**
 * Saves a fee schedule. A schedule that has priced a bill cannot change its amounts; add a new
 * schedule with a later date instead. Bills keep the amount they were issued with either way.
 */
export async function saveSchedule(input: ScheduleInput & { actorUserId: string }) {
  validate(input);
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    let id = input.id ?? null;
    if (id) {
      const existing = await tx.feeSchedule.findUnique({ where: { id }, include: { _count: { select: { bills: true } } } });
      if (!existing) throw new AppError("NOT_FOUND", "That schedule was not found.", 404);
      if (existing._count.bills > 0) {
        throw new AppError("LOCKED", "Bills were issued under this schedule. Add a new schedule with a later date instead.", 409);
      }
      await tx.feeSchedule.update({
        where: { id },
        data: { effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`), approvedRef: input.approvedRef.trim(), notes: input.notes.trim() },
      });
      await tx.feeRate.deleteMany({ where: { scheduleId: id } });
      await tx.feeRule.deleteMany({ where: { scheduleId: id } });
    } else {
      const created = await tx.feeSchedule.create({
        data: {
          effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00Z`),
          approvedRef: input.approvedRef.trim(),
          notes: input.notes.trim(),
          createdById: input.actorUserId,
        },
      });
      id = created.id;
    }
    if (input.rates.length > 0) {
      await tx.feeRate.createMany({ data: input.rates.map((rate) => ({ scheduleId: id!, clientTypeKey: rate.clientTypeKey, basis: rate.basis, amount: rate.amount })) });
    }
    if (input.rules.length > 0) {
      await tx.feeRule.createMany({
        data: input.rules.map((rule) => ({ scheduleId: id!, key: rule.key.trim().toUpperCase(), label: rule.label.trim(), percent: rule.percent, fromRound: rule.fromRound })),
      });
    }
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.feeScheduleSaved,
      entityType: "fee_schedule",
      entityId: id,
      diff: { effectiveFrom: input.effectiveFrom, rates: input.rates.length, rules: input.rules.length, approvedRef: input.approvedRef } as Prisma.InputJsonObject,
      meta,
    });
    return id;
  });
}

/** Preview calculator: the amount a bill would have on `day`. */
export async function previewFee(input: { day: string; clientTypeKey: string; reviewType: string; basis: string; round: number }) {
  const schedule = scheduleOn(await loadSchedules(prisma), input.day);
  if (!schedule) return { schedule: null, quote: null };
  if (!isFeeBasis(input.reviewType)) return { schedule, quote: null };
  return { schedule, quote: quoteFee(schedule, { clientTypeKey: input.clientTypeKey, reviewType: input.reviewType, basis: input.basis, round: input.round }) };
}

export { FEE_BASES };
