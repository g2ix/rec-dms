import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { audit, auditRequestMeta } from "@/server/audit";
import { conflictMessage, rolesConflict } from "@/server/auth/conflicts";
import { verifyPassword } from "@/server/auth/passwords";
import { verifyEmailCode } from "@/server/auth/codes";

type Moved = {
  accounts: number;
  emails: number;
  memberships: number;
  roles: number;
  signatures: number;
  notifications: number;
  tasks: number;
};

async function conflictingMemberships(tx: Prisma.TransactionClient, primaryUserId: string, secondaryUserId: string) {
  const [primaryMembers, secondaryMembers] = await Promise.all([
    tx.protocolMember.findMany({
      where: { userId: primaryUserId, status: { not: "REMOVED" } },
      include: { protocol: true },
    }),
    tx.protocolMember.findMany({
      where: { userId: secondaryUserId, status: { not: "REMOVED" } },
      include: { protocol: true },
    }),
  ]);
  const conflicts = [];
  for (const secondary of secondaryMembers) {
    const primary = primaryMembers.find((member) => member.protocolId === secondary.protocolId);
    if (!primary) continue;
    if (!rolesConflict(primary.role, secondary.role)) continue;
    conflicts.push({
      code: primary.protocol.code,
      title: primary.protocol.title,
      left: primary.role,
      right: secondary.role,
    });
  }
  return conflicts;
}

async function moveUserInto(
  tx: Prisma.TransactionClient,
  input: { primaryUserId: string; secondaryUserId: string; actorUserId: string; via: "self" | "admin" },
) {
  if (input.primaryUserId === input.secondaryUserId) {
    throw new AppError("MERGE_SELF", "Choose two different accounts.", 400);
  }
  const [primary, secondary] = await Promise.all([
    tx.user.findUnique({ where: { id: input.primaryUserId } }),
    tx.user.findUnique({ where: { id: input.secondaryUserId } }),
  ]);
  if (!primary || !secondary) throw new AppError("NOT_FOUND", "One of those accounts was not found.", 404);
  if (primary.status === "MERGED" || secondary.status === "MERGED" || primary.mergedIntoId || secondary.mergedIntoId) {
    throw new AppError("MERGE_UNAVAILABLE", "One of those accounts is already merged.", 400);
  }
  const conflicts = await conflictingMemberships(tx, primary.id, secondary.id);
  if (conflicts.length > 0) {
    throw new AppError("MERGE_CONFLICT", conflictMessage(conflicts), 409);
  }

  const [accounts, emails, memberships, roles, signatures, notifications, tasks] = await Promise.all([
    tx.account.findMany({ where: { userId: secondary.id } }),
    tx.userEmail.findMany({ where: { userId: secondary.id } }),
    tx.protocolMember.findMany({ where: { userId: secondary.id } }),
    tx.userRole.findMany({ where: { userId: secondary.id } }),
    tx.signature.findMany({ where: { userId: secondary.id } }),
    tx.notification.findMany({ where: { userId: secondary.id } }),
    tx.task.findMany({ where: { assigneeUserId: secondary.id } }),
  ]);

  const primaryEmails = await tx.userEmail.findMany({ where: { userId: primary.id } });
  const primaryHasContact = primaryEmails.some((email) => email.isContact);
  const primaryHasPrimary = primaryEmails.some((email) => email.isPrimary);
  const primaryRoles = await tx.userRole.findMany({ where: { userId: primary.id, revokedAt: null } });
  const primaryMemberships = await tx.protocolMember.findMany({
    where: { userId: primary.id, status: { not: "REMOVED" } },
  });

  await tx.user.update({
    where: { id: secondary.id },
    data: { primaryEmailId: null, email: null, emailVerified: null },
  });

  for (const email of emails) {
    await tx.userEmail.update({
      where: { id: email.id },
      data: {
        userId: primary.id,
        isContact: primaryHasContact ? false : email.isContact,
        isPrimary: primaryHasPrimary ? false : email.isPrimary,
      },
    });
  }
  if (!primary.primaryEmailId) {
    const chosen = emails.find((email) => email.isPrimary) ?? emails[0];
    if (chosen) {
      await tx.userEmail.update({ where: { id: chosen.id }, data: { isPrimary: true } });
      await tx.user.update({
        where: { id: primary.id },
        data: { primaryEmailId: chosen.id, email: chosen.email, emailVerified: chosen.verifiedAt },
      });
    }
  }
  if (!primaryHasContact && !emails.some((email) => email.isContact) && emails[0]) {
    await tx.userEmail.update({ where: { id: emails[0].id }, data: { isContact: true } });
  }

  await tx.account.updateMany({ where: { userId: secondary.id }, data: { userId: primary.id } });

  let movedMemberships = 0;
  for (const membership of memberships) {
    const duplicate = primaryMemberships.find((item) => item.protocolId === membership.protocolId);
    if (duplicate) {
      await tx.protocolMember.delete({ where: { id: membership.id } });
      continue;
    }
    await tx.protocolMember.update({ where: { id: membership.id }, data: { userId: primary.id } });
    movedMemberships += 1;
  }

  let movedRoles = 0;
  for (const grant of roles) {
    const duplicate = primaryRoles.find(
      (item) => item.roleId === grant.roleId && item.panelId === grant.panelId && grant.revokedAt === null,
    );
    if (duplicate) {
      await tx.userRole.delete({ where: { id: grant.id } });
      continue;
    }
    await tx.userRole.update({ where: { id: grant.id }, data: { userId: primary.id } });
    movedRoles += 1;
  }

  const primaryHasActive = await tx.signature.findFirst({
    where: { userId: primary.id, active: true },
    select: { id: true },
  });
  if (primaryHasActive) {
    await tx.signature.updateMany({ where: { userId: secondary.id, active: true }, data: { active: false } });
  }
  await tx.signature.updateMany({ where: { userId: secondary.id }, data: { userId: primary.id } });
  await tx.signatureEvent.updateMany({ where: { userId: secondary.id }, data: { userId: primary.id } });
  await tx.signingStepUp.deleteMany({ where: { userId: secondary.id } });
  await tx.notification.updateMany({ where: { userId: secondary.id }, data: { userId: primary.id } });
  await tx.task.updateMany({ where: { assigneeUserId: secondary.id }, data: { assigneeUserId: primary.id } });
  await tx.protocol.updateMany({ where: { createdById: secondary.id }, data: { createdById: primary.id } });
  await tx.protocol.updateMany({ where: { leaderUserId: secondary.id }, data: { leaderUserId: primary.id } });
  await tx.protocolVersion.updateMany({ where: { submittedById: secondary.id }, data: { submittedById: primary.id } });
  await tx.storedFile.updateMany({ where: { uploadedById: secondary.id }, data: { uploadedById: primary.id } });
  await tx.feeVerification.updateMany({ where: { verifiedById: secondary.id }, data: { verifiedById: primary.id } });
  await tx.uploadIntent.updateMany({ where: { uploadedById: secondary.id }, data: { uploadedById: primary.id } });
  await tx.protocolMember.updateMany({ where: { invitedById: secondary.id }, data: { invitedById: primary.id } });
  await tx.emailCode.updateMany({ where: { userId: secondary.id }, data: { userId: primary.id } });
  await tx.session.deleteMany({ where: { userId: secondary.id } });

  await tx.user.update({
    where: { id: primary.id },
    data: {
      passwordHash: primary.passwordHash ?? secondary.passwordHash,
    },
  });
  await tx.user.update({
    where: { id: secondary.id },
    data: {
      status: "MERGED",
      mergedIntoId: primary.id,
      passwordHash: null,
    },
  });

  const moved: Moved = {
    accounts: accounts.length,
    emails: emails.length,
    memberships: movedMemberships,
    roles: movedRoles,
    signatures: signatures.length,
    notifications: notifications.length,
    tasks: tasks.length,
  };

  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: "user.merged",
    entityType: "user",
    entityId: primary.id,
    diff: {
      primaryUserId: primary.id,
      secondaryUserId: secondary.id,
      moved,
    },
    meta: await auditRequestMeta({ via: input.via }),
  });

  return moved;
}

async function assertStepUp(userId: string, password: string | undefined, code: string | undefined, email: string | undefined) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("NOT_FOUND", "That account was not found.", 404);
  if (password && user.passwordHash && (await verifyPassword(user.passwordHash, password))) return;
  if (code && email) {
    const owned = await prisma.userEmail.findFirst({
      where: { userId, email: email.toLowerCase(), verifiedAt: { not: null } },
    });
    if (!owned) throw new AppError("CODE_INVALID", "That code is not valid.", 400);
    await verifyEmailCode({ email: owned.email, purpose: "STEP_UP", code });
    return;
  }
  throw new AppError("STEP_UP_FAILED", "Enter the password or the code sent to that account.", 400);
}

export async function confirmMergeStepUp(input: {
  sessionId: string;
  actorUserId: string;
  side: "primary" | "secondary";
  password?: string;
  code?: string;
  email?: string;
}) {
  const session = await prisma.mergeSession.findUnique({ where: { id: input.sessionId } });
  if (!session || session.completedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new AppError("MERGE_EXPIRED", "This merge has expired. Start it again.", 400);
  }
  if (session.mode !== "SELF" || session.primaryUserId !== input.actorUserId) {
    throw new AppError("FORBIDDEN", "Only the account you are keeping can confirm this merge.", 403);
  }
  const userId = input.side === "primary" ? session.primaryUserId : session.secondaryUserId;
  await assertStepUp(userId, input.password, input.code, input.email);
  return prisma.mergeSession.update({
    where: { id: session.id },
    data: input.side === "primary" ? { primaryStepUpAt: new Date() } : { secondaryStepUpAt: new Date() },
  });
}

export async function completeSelfMerge(actorUserId: string, sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.mergeSession.findUnique({ where: { id: sessionId } });
    if (!session || session.completedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError("MERGE_EXPIRED", "This merge has expired. Start it again.", 400);
    }
    if (session.primaryUserId !== actorUserId || session.mode !== "SELF") {
      throw new AppError("FORBIDDEN", "Only the account you are keeping can confirm this merge.", 403);
    }
    if (!session.primaryStepUpAt || !session.secondaryStepUpAt) {
      throw new AppError("STEP_UP_REQUIRED", "Sign in to both accounts before merging them.", 400);
    }
    const moved = await moveUserInto(tx, {
      primaryUserId: session.primaryUserId,
      secondaryUserId: session.secondaryUserId,
      actorUserId,
      via: "self",
    });
    await tx.mergeSession.update({ where: { id: session.id }, data: { completedAt: new Date() } });
    return moved;
  });
}

export async function mergeAsAdmin(adminUserId: string, primaryUserId: string, secondaryUserId: string) {
  return prisma.$transaction(async (tx) => {
    return moveUserInto(tx, {
      primaryUserId,
      secondaryUserId,
      actorUserId: adminUserId,
      via: "admin",
    });
  });
}

export async function assertCanAuthenticate(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status === "MERGED" || user.status === "SUSPENDED" || user.mergedIntoId) {
    throw new AppError("SIGN_IN_BLOCKED", "This account can no longer be used to sign in.", 403);
  }
  return user;
}
