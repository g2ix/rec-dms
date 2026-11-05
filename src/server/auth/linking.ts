import "server-only";
import type { ProtocolMemberRole } from "@prisma/client";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { ensureVerifiedEmail } from "@/server/auth/users";

const MERGE_TTL_MS = 30 * 60 * 1000;

export async function userForProviderAccount(provider: string, providerAccountId: string) {
  const account = await prisma.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  if (!account) return null;
  if (account.user.status === "MERGED" || account.user.status === "SUSPENDED" || account.user.mergedIntoId) {
    return null;
  }
  return account.user;
}

export async function findOrStartSelfMerge(primaryUserId: string, secondaryUserId: string) {
  if (primaryUserId === secondaryUserId) {
    throw new AppError("MERGE_SELF", "That sign-in method is already on this account.", 400);
  }
  const secondary = await prisma.user.findUnique({ where: { id: secondaryUserId } });
  if (!secondary || secondary.status === "MERGED" || secondary.mergedIntoId) {
    throw new AppError("MERGE_UNAVAILABLE", "That account can no longer be merged.", 400);
  }
  const existing = await prisma.mergeSession.findFirst({
    where: {
      primaryUserId,
      secondaryUserId,
      mode: "SELF",
      completedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.mergeSession.create({
    data: {
      primaryUserId,
      secondaryUserId,
      createdById: primaryUserId,
      mode: "SELF",
      expiresAt: new Date(Date.now() + MERGE_TTL_MS),
    },
  });
}

export async function linkProviderAccount(input: {
  userId: string;
  provider: string;
  providerAccountId: string;
  email: string;
  type?: string;
}): Promise<{ linked: true } | { mergeSessionId: string }> {
  const email = normalizeEmail(input.email);
  const existing = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
  });
  if (existing) {
    if (existing.userId === input.userId) {
      await ensureVerifiedEmail(input.userId, email);
      if (existing.email !== email) {
        await prisma.account.update({ where: { id: existing.id }, data: { email } });
      }
      return { linked: true };
    }
    const session = await findOrStartSelfMerge(input.userId, existing.userId);
    return { mergeSessionId: session.id };
  }
  const emailOwner = await prisma.userEmail.findUnique({ where: { email } });
  if (emailOwner && emailOwner.userId !== input.userId) {
    const session = await findOrStartSelfMerge(input.userId, emailOwner.userId);
    return { mergeSessionId: session.id };
  }
  await prisma.account.create({
    data: {
      userId: input.userId,
      type: input.type ?? "oidc",
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      email,
    },
  });
  await ensureVerifiedEmail(input.userId, email);
  // AUDIT: auth.identity_linked
  return { linked: true };
}

export async function listSignInMethods(userId: string) {
  const [user, accounts, emails] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.account.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
    prisma.userEmail.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    hasPassword: Boolean(user.passwordHash),
    accounts: accounts.map((account) => ({
      id: account.id,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      email: account.email,
    })),
    emails: emails.map((email) => ({
      id: email.id,
      email: email.email,
      verified: Boolean(email.verifiedAt),
      isContact: email.isContact,
      isPrimary: email.isPrimary,
    })),
  };
}

export function signInWayCount(input: { accounts: number; emails: number; hasPassword: boolean }): number {
  const passwordWay = input.hasPassword && input.emails > 0 ? 1 : 0;
  return input.accounts + input.emails + passwordWay;
}

export async function removeSignInMethod(
  userId: string,
  method: { kind: "password" } | { kind: "oauth"; accountId: string } | { kind: "email"; emailId: string },
) {
  const current = await listSignInMethods(userId);
  const next = {
    accounts: current.accounts.length,
    emails: current.emails.length,
    hasPassword: current.hasPassword,
  };
  if (method.kind === "password") next.hasPassword = false;
  if (method.kind === "oauth") next.accounts -= 1;
  if (method.kind === "email") next.emails -= 1;
  if (signInWayCount(next) < 1) {
    throw new AppError("LAST_METHOD", "The last sign-in method cannot be removed.", 400);
  }
  if (method.kind === "password") {
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
    // AUDIT: auth.password_removed
    return;
  }
  if (method.kind === "oauth") {
    const account = current.accounts.find((item) => item.id === method.accountId);
    if (!account) throw new AppError("NOT_FOUND", "That sign-in method was not found.", 404);
    await prisma.account.delete({ where: { id: account.id } });
    // AUDIT: auth.identity_unlinked
    return;
  }
  const email = current.emails.find((item) => item.id === method.emailId);
  if (!email) throw new AppError("NOT_FOUND", "That email was not found.", 404);
  const used = await prisma.protocolMember.count({ where: { contactEmailId: email.id } });
  if (used > 0) {
    throw new AppError(
      "EMAIL_IN_USE",
      "That email is the contact email on a protocol. Choose another contact email there first.",
      400,
    );
  }
  const replacement = current.emails.find((item) => item.id !== email.id);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.primaryEmailId === email.id) {
      await tx.user.update({
        where: { id: userId },
        data: { primaryEmailId: null, email: null, emailVerified: null },
      });
    }
    await tx.userEmail.update({
      where: { id: email.id },
      data: { isContact: false, isPrimary: false },
    });
    if (replacement) {
      await tx.userEmail.update({
        where: { id: replacement.id },
        data: {
          isPrimary: user.primaryEmailId === email.id ? true : undefined,
          isContact: email.isContact ? true : undefined,
        },
      });
      if (user.primaryEmailId === email.id) {
        await tx.user.update({
          where: { id: userId },
          data: { primaryEmailId: replacement.id, email: replacement.email, emailVerified: new Date() },
        });
      }
    }
    await tx.userEmail.delete({ where: { id: email.id } });
  });
  // AUDIT: auth.email_removed
}

export async function setContactEmail(userId: string, emailId: string) {
  const email = await prisma.userEmail.findFirst({ where: { id: emailId, userId, verifiedAt: { not: null } } });
  if (!email) throw new AppError("NOT_FOUND", "That email is not on this account.", 404);
  await prisma.$transaction([
    prisma.userEmail.updateMany({ where: { userId }, data: { isContact: false } }),
    prisma.userEmail.update({ where: { id: emailId }, data: { isContact: true } }),
  ]);
  // AUDIT: auth.contact_email_set
}

export async function setPassword(userId: string, passwordHash: string) {
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // AUDIT: auth.password_set
}

export async function startEmailLink(userId: string, email: string) {
  const normalized = normalizeEmail(email);
  const owner = await prisma.userEmail.findUnique({ where: { email: normalized } });
  if (owner?.userId === userId) {
    throw new AppError("EMAIL_EXISTS", "That email is already on this account.", 400);
  }
  if (owner) {
    const session = await findOrStartSelfMerge(userId, owner.userId);
    return { mergeSessionId: session.id };
  }
  return { mergeSessionId: null as string | null, email: normalized };
}

export type MemberRole = ProtocolMemberRole;
