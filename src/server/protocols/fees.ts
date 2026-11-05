import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function listPendingReceipts() {
  return prisma.feeVerification.findMany({
    where: { status: "PENDING" },
    include: {
      protocolVersion: {
        include: {
          protocol: true,
          files: { where: { kind: "FEE_RECEIPT" }, orderBy: { createdAt: "desc" } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function decideFee(input: {
  feeId: string;
  actorUserId: string;
  decision: "VERIFIED" | "REJECTED";
  reason?: string | null;
}) {
  const reason = input.reason?.trim() || null;
  if (input.decision === "REJECTED" && !reason) {
    throw new AppError("INVALID", "Give a reason for rejecting the receipt.", 400);
  }
  const meta = await auditRequestMeta({ decision: input.decision });
  return prisma.$transaction(async (tx) => {
    const fee = await tx.feeVerification.findUnique({
      where: { id: input.feeId },
      include: { protocolVersion: true },
    });
    if (!fee) throw new AppError("NOT_FOUND", "That receipt was not found.", 404);
    const updated = await tx.feeVerification.update({
      where: { id: fee.id },
      data: {
        status: input.decision,
        reason,
        verifiedById: input.actorUserId,
        verifiedAt: new Date(),
      },
    });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      actingRole: "REC_STAFF",
      action: input.decision === "VERIFIED" ? AuditAction.feeVerified : AuditAction.feeRejected,
      entityType: "fee_verification",
      entityId: fee.id,
      protocolId: fee.protocolVersion.protocolId,
      diff: diffOf({ status: fee.status, reason: fee.reason }, { status: input.decision, reason }),
      meta,
    });
    return updated;
  });
}
