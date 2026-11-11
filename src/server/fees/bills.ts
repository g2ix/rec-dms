import "server-only";
import type { BillStatus, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { billSettled, fillPattern, isFeeBasis, outstanding, quoteFee, roundLabel, scheduleOn, type ScheduleData } from "@/lib/fees/calc";
import { manilaDay } from "@/lib/workflow/calendar";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { recordNotice } from "@/server/notifications/deliver";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const REVIEW_WORDS: Record<string, string> = { EXEMPT: "Exempt Review", EXPEDITED: "Expedited Review", FULL: "Full Review" };

export async function loadSchedules(db: Db): Promise<ScheduleData[]> {
  const rows = await db.feeSchedule.findMany({ include: { rates: true, rules: true }, orderBy: { effectiveFrom: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    effectiveFrom: row.effectiveFrom,
    rates: row.rates.map((rate) => ({ clientTypeKey: rate.clientTypeKey, basis: rate.basis, amount: rate.amount })),
    rules: row.rules.map((rule) => ({ key: rule.key, label: rule.label, percent: rule.percent, fromRound: rule.fromRound })),
  }));
}

/** The review round of a protocol version: 1 for the initial review, 2 for the first resubmission, and so on. */
export async function roundOf(db: Db, protocolVersionId: string): Promise<number> {
  const version = await db.protocolVersion.findUnique({ where: { id: protocolVersionId }, select: { number: true } });
  return version?.number ?? 1;
}

/**
 * ISSUE_BILL. Prices the bill from the schedule in effect today and records it. Issuing never
 * blocks the workflow: when the protocol has no client type or the schedule has no rate, REC
 * Staff are told and no bill is created. A zero amount is recorded as WAIVED.
 */
export async function issueBillTx(
  tx: Tx,
  input: { protocolId: string; protocolVersionId: string; basis: string; actorUserId: string | null; meta: Prisma.InputJsonObject; now?: Date },
) {
  const now = input.now ?? new Date();
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: input.protocolId } });
  const round = await roundOf(tx, input.protocolVersionId);
  const existing = await tx.bill.findFirst({
    where: { protocolId: protocol.id, round, basis: input.basis, status: { not: "REJECTED" } },
  });
  if (existing) return existing;
  const reviewType = protocol.reviewType;
  const schedule = scheduleOn(await loadSchedules(tx), manilaDay(now));
  if (!protocol.clientTypeKey || !isFeeBasis(reviewType) || !schedule) {
    await tellStaff(tx, protocol.id, protocol.clientTypeKey ? "There is no fee schedule or review type to price this bill." : "Set the client type so the bill can be issued.");
    return null;
  }
  const quote = quoteFee(schedule, { clientTypeKey: protocol.clientTypeKey, reviewType, basis: input.basis, round });
  if (!quote) {
    const rule = input.basis !== "reviewType" ? schedule.rules.find((item) => item.key === (input.basis === "nthReview" ? "NTH_REVIEW" : input.basis)) : null;
    if (rule?.fromRound != null && round < rule.fromRound) return null;
    await tellStaff(tx, protocol.id, "The fee schedule has no rate for this client type and review.");
    return null;
  }
  const pattern = await settingValue(tx, "fees.description", now);
  const review = quote.rule?.key === "NTH_REVIEW" ? roundLabel(round) : quote.rule ? quote.rule.label : (REVIEW_WORDS[reviewType] ?? reviewType);
  const description = fillPattern(typeof pattern === "string" && pattern.trim() ? pattern : "Review fee for {code}: {title} ({review})", {
    code: protocol.code ?? "",
    title: protocol.title,
    review,
    round: String(round),
  });
  const status: BillStatus = quote.amount === 0 ? "WAIVED" : "ISSUED";
  const bill = await tx.bill.create({
    data: {
      protocolId: protocol.id,
      versionId: input.protocolVersionId,
      round,
      description,
      amount: quote.amount,
      scheduleId: quote.scheduleId,
      clientTypeKey: protocol.clientTypeKey,
      basis: input.basis,
      status,
      issuedById: input.actorUserId,
      issuedAt: now,
    },
  });
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: AuditAction.billIssued,
    entityType: "bill",
    entityId: bill.id,
    protocolId: protocol.id,
    diff: diffOf({}, { amount: bill.amount, status, round, basis: input.basis, scheduleId: quote.scheduleId, clientTypeKey: protocol.clientTypeKey }),
    meta: input.meta,
  });
  if (status === "ISSUED") {
    await tx.job.create({ data: { kind: "GENERATE_STATEMENT", payload: toJson({ billId: bill.id }), runAt: now } });
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({ templateKey: "fee.bill_issued", userIds: [protocol.leaderUserId], protocolId: protocol.id }),
        runAt: now,
      },
    });
  }
  return bill;
}

async function tellStaff(tx: Tx, protocolId: string, reason: string) {
  const staff = await tx.userRole.findMany({ where: { revokedAt: null, role: { key: "REC_STAFF" } }, select: { userId: true } });
  const userIds = [...new Set(staff.map((row) => row.userId))];
  if (userIds.length === 0) return;
  await recordNotice(tx, {
    userIds,
    templateKey: "fee.bill_not_issued",
    protocolId,
    link: `/app/protocols/${protocolId}`,
    variables: { reason },
  });
}

/** The bill for the round under review, if one was issued. */
export async function currentBill(db: Db, protocolId: string, protocolVersionId: string) {
  const round = await roundOf(db, protocolVersionId);
  return db.bill.findFirst({
    where: { protocolId, round, status: { not: "REJECTED" } },
    orderBy: { issuedAt: "desc" },
  });
}

/**
 * The fee check on a fee-gated outcome. Returns null when it passes, or what is outstanding.
 * A protocol with no bill for this round falls back to the receipt check of earlier graphs.
 */
export async function feeBlock(
  tx: Tx,
  protocolId: string,
  protocolVersionId: string,
): Promise<{ billId: string | null; outstanding: number; message: string } | null> {
  const bill = await currentBill(tx, protocolId, protocolVersionId);
  if (bill) {
    if (billSettled(bill.status)) return null;
    return { billId: bill.id, outstanding: outstanding(bill), message: "The bill for this review is not paid in full." };
  }
  const fee = await tx.feeVerification.findUnique({ where: { protocolVersionId } });
  if (fee?.status === "VERIFIED") return null;
  return { billId: null, outstanding: 0, message: "Verify the fee receipt before accepting the submission." };
}

export async function listOpenBills() {
  return prisma.bill.findMany({
    where: { status: { in: ["ISSUED", "PAID_PENDING", "PARTIALLY_PAID", "REJECTED"] } },
    include: { protocol: { select: { id: true, code: true, title: true } } },
    orderBy: { issuedAt: "asc" },
  });
}

export async function billFiles(billIds: string[]) {
  if (billIds.length === 0) return [];
  return prisma.storedFile.findMany({ where: { billId: { in: billIds } }, orderBy: { createdAt: "desc" } });
}

/** REC Staff verify a payment, reject it, or record a partial amount (centavos). */
export async function decideBill(input: {
  billId: string;
  actorUserId: string;
  decision: "VERIFIED" | "REJECTED" | "PARTIAL";
  amountPaid?: number | null;
  reason?: string | null;
}) {
  const reason = input.reason?.trim() || null;
  if (input.decision === "REJECTED" && !reason) throw new AppError("INVALID", "Give a reason for rejecting the payment.", 400);
  const meta = await auditRequestMeta({ decision: input.decision });
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({ where: { id: input.billId }, include: { protocol: { select: { leaderUserId: true } } } });
    if (!bill) throw new AppError("NOT_FOUND", "That bill was not found.", 404);
    if (bill.status === "WAIVED" || bill.status === "VERIFIED") throw new AppError("INVALID", "That bill is already settled.", 409);
    let status: BillStatus;
    let amountPaid = bill.amountPaid;
    if (input.decision === "VERIFIED") {
      status = "VERIFIED";
      amountPaid = bill.amount;
    } else if (input.decision === "REJECTED") {
      status = "REJECTED";
    } else {
      const paid = input.amountPaid ?? 0;
      if (!Number.isInteger(paid) || paid <= 0) throw new AppError("INVALID", "Enter the amount paid.", 400);
      amountPaid = Math.min(bill.amount, bill.amountPaid + paid);
      status = amountPaid >= bill.amount ? "VERIFIED" : "PARTIALLY_PAID";
    }
    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: { status, amountPaid, reason, verifiedById: input.actorUserId, verifiedAt: new Date() },
    });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      actingRole: "REC_STAFF",
      action:
        status === "VERIFIED" ? AuditAction.billVerified : status === "REJECTED" ? AuditAction.billRejected : AuditAction.billPartiallyPaid,
      entityType: "bill",
      entityId: bill.id,
      protocolId: bill.protocolId,
      diff: diffOf({ status: bill.status, amountPaid: bill.amountPaid }, { status, amountPaid, reason }),
      meta,
    });
    if (status === "REJECTED" || status === "PARTIALLY_PAID") {
      await recordNotice(tx, {
        userIds: [bill.protocol.leaderUserId],
        templateKey: "fee.rejected",
        protocolId: bill.protocolId,
        link: `/app/protocols/${bill.protocolId}`,
        variables: { reason: reason ?? "Part of the bill is still unpaid." },
      });
    }
    return updated;
  });
}

/** A rejected bill reopens when new proof arrives; any open bill moves to PAID_PENDING. */
export async function markProofUploaded(tx: Tx, billId: string, userId: string, fileId: string, meta: Prisma.InputJsonObject) {
  const bill = await tx.bill.findUnique({ where: { id: billId } });
  if (!bill) throw new AppError("NOT_FOUND", "That bill was not found.", 404);
  if (billSettled(bill.status)) throw new AppError("INVALID", "That bill is already settled.", 409);
  const status: BillStatus = bill.status === "PARTIALLY_PAID" ? "PARTIALLY_PAID" : "PAID_PENDING";
  await tx.bill.update({ where: { id: bill.id }, data: { status, reason: bill.status === "REJECTED" ? null : bill.reason } });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.billPaymentUploaded,
    entityType: "bill",
    entityId: bill.id,
    protocolId: bill.protocolId,
    diff: diffOf({ status: bill.status }, { status, fileId }),
    meta,
  });
}

export async function protocolBills(protocolId: string) {
  return prisma.bill.findMany({ where: { protocolId }, orderBy: { issuedAt: "desc" } });
}

export type BillReportRow = {
  period: string;
  panel: string;
  clientType: string;
  issued: number;
  issuedAmount: number;
  paidAmount: number;
};

/** Bills issued and paid, grouped by month of issue, panel and client type. */
export async function billReport(input: { from?: string; to?: string }) {
  const where: Prisma.BillWhereInput = {};
  if (input.from || input.to) {
    where.issuedAt = {
      ...(input.from ? { gte: new Date(`${input.from}T00:00:00+08:00`) } : {}),
      ...(input.to ? { lte: new Date(`${input.to}T23:59:59+08:00`) } : {}),
    };
  }
  const [bills, types, shares] = await Promise.all([
    prisma.bill.findMany({ where, include: { protocol: { select: { panel: { select: { name: true } } } } } }),
    prisma.clientType.findMany(),
    settingValue(prisma, "fees.distribution"),
  ]);
  const label = new Map(types.map((type) => [type.key, type.label]));
  const groups = new Map<string, BillReportRow>();
  for (const bill of bills) {
    const period = manilaDay(bill.issuedAt).slice(0, 7);
    const panel = bill.protocol.panel?.name ?? "No panel";
    const clientType = label.get(bill.clientTypeKey ?? "") ?? bill.clientTypeKey ?? "—";
    const key = `${period}|${panel}|${clientType}`;
    const row = groups.get(key) ?? { period, panel, clientType, issued: 0, issuedAmount: 0, paidAmount: 0 };
    row.issued += 1;
    row.issuedAmount += bill.amount;
    row.paidAmount += bill.status === "VERIFIED" ? bill.amount : bill.amountPaid;
    groups.set(key, row);
  }
  const rows = [...groups.values()].sort((a, b) => `${a.period}${a.panel}${a.clientType}`.localeCompare(`${b.period}${b.panel}${b.clientType}`));
  const distribution: Record<string, number> = {};
  if (shares && typeof shares === "object" && !Array.isArray(shares)) {
    for (const [name, value] of Object.entries(shares as Record<string, unknown>)) if (typeof value === "number") distribution[name] = value;
  }
  return { rows, distribution, totalPaid: rows.reduce((sum, row) => sum + row.paidAmount, 0) };
}
