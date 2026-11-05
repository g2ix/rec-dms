import "server-only";
import type { Prisma, UserStatus } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { formatDisplayName } from "@/lib/display-name";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { AppError } from "@/server/errors";

type Writer = Prisma.TransactionClient | typeof prisma;

export async function createPerson(
  input: {
    firstName: string;
    middleInitial?: string | null;
    familyName: string;
    email: string;
    passwordHash?: string | null;
    status: UserStatus;
    image?: string | null;
  },
  db: Writer = prisma,
) {
  const email = normalizeEmail(input.email);
  const taken = await db.userEmail.findUnique({ where: { email } });
  if (taken) throw new AppError("EMAIL_TAKEN", "An account already uses this email.", 409);
  const middleInitial = input.middleInitial?.trim().replace(/\.$/, "") || null;
  const displayName = formatDisplayName(input.firstName, middleInitial, input.familyName);
  const verifiedAt = new Date();
  const user = await db.user.create({
    data: {
      firstName: input.firstName.trim(),
      middleInitial,
      familyName: input.familyName.trim(),
      displayName,
      name: displayName,
      email,
      emailVerified: verifiedAt,
      image: input.image ?? null,
      status: input.status,
      passwordHash: input.passwordHash ?? null,
      emails: {
        create: {
          email,
          verifiedAt,
          isContact: true,
          isPrimary: true,
        },
      },
    },
    include: { emails: true },
  });
  return db.user.update({
    where: { id: user.id },
    data: { primaryEmailId: user.emails[0]?.id },
    include: { emails: true },
  });
}

export async function ensureVerifiedEmail(userId: string, email: string, db: Writer = prisma) {
  const normalized = normalizeEmail(email);
  const existing = await db.userEmail.findUnique({ where: { email: normalized } });
  if (existing && existing.userId !== userId) {
    throw new AppError("EMAIL_TAKEN", "That email already belongs to another account.", 409);
  }
  if (existing) {
    if (!existing.verifiedAt) {
      return db.userEmail.update({
        where: { id: existing.id },
        data: { verifiedAt: new Date() },
      });
    }
    return existing;
  }
  const count = await db.userEmail.count({ where: { userId } });
  const created = await db.userEmail.create({
    data: {
      userId,
      email: normalized,
      verifiedAt: new Date(),
      isContact: count === 0,
      isPrimary: count === 0,
    },
  });
  if (count === 0) {
    await db.user.update({
      where: { id: userId },
      data: { primaryEmailId: created.id, email: normalized, emailVerified: created.verifiedAt },
    });
  }
  return created;
}

export async function decidePendingUser(input: {
  actorUserId: string;
  userId: string;
  decision: "approve" | "reject";
}) {
  const before = await prisma.user.findUnique({ where: { id: input.userId }, select: { status: true } });
  if (!before) throw new AppError("NOT_FOUND", "That account was not found.", 404);
  const status = input.decision === "approve" ? "ACTIVE" : "SUSPENDED";
  const meta = await auditRequestMeta();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { status, approvedById: input.actorUserId, approvedAt: new Date() },
    });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: input.decision === "approve" ? AuditAction.userApproved : AuditAction.userRejected,
      entityType: "user",
      entityId: input.userId,
      diff: diffOf({ status: before.status }, { status }),
      meta,
    });
    return updated;
  });
}
