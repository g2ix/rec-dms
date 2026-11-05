import "server-only";
import type { Prisma } from "@prisma/client";
import { verifyEmailCode } from "@/server/auth/codes";
import { verifyPassword } from "@/server/auth/passwords";
import { rateLimiter } from "@/server/auth/rate-limit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export const SIGNING_STEP_UP_MS = 10 * 60 * 1000;
const CONFIRM_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

type Tx = Prisma.TransactionClient;

export async function contactEmail(userId: string): Promise<string | null> {
  const row = await prisma.userEmail.findFirst({
    where: { userId },
    orderBy: [{ isContact: "desc" }, { isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return row?.email ?? null;
}

/** Password accounts re-enter the password. Accounts without a password use the emailed code. */
export async function confirmSigningStepUp(input: {
  userId: string;
  password?: string;
  code?: string;
  now?: Date;
}): Promise<{ expiresAt: Date }> {
  const now = input.now ?? new Date();
  const hit = await rateLimiter.hit(`stepup:${input.userId}`, CONFIRM_LIMIT.limit, CONFIRM_LIMIT.windowMs, now);
  if (!hit.ok) throw new AppError("RATE_LIMITED", "Too many confirmation attempts. Try again later.", 429);

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || user.status === "MERGED" || user.status === "SUSPENDED") {
    throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
  }

  if (user.passwordHash) {
    const password = input.password?.trim() ?? "";
    if (!password || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError("STEP_UP_FAILED", "Enter your password to confirm it is you.", 400);
    }
  } else {
    const email = await contactEmail(user.id);
    if (!email) throw new AppError("STEP_UP_FAILED", "This account has no contact email for a confirmation code.", 400);
    const code = input.code?.trim() ?? "";
    if (!code) throw new AppError("STEP_UP_FAILED", "Enter the code sent to your contact email.", 400);
    await verifyEmailCode({ email, purpose: "STEP_UP", code });
  }

  const expiresAt = new Date(now.getTime() + SIGNING_STEP_UP_MS);
  await prisma.signingStepUp.create({
    data: { userId: user.id, confirmedAt: now, expiresAt },
  });
  return { expiresAt };
}

export async function signingStepUpFresh(userId: string, now = new Date()): Promise<boolean> {
  const row = await prisma.signingStepUp.findFirst({
    where: { userId, expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });
  return Boolean(row);
}

export async function assertFreshSigningStepUp(tx: Tx, userId: string, now = new Date()): Promise<void> {
  const latest = await tx.signingStepUp.findFirst({
    where: { userId },
    orderBy: { confirmedAt: "desc" },
  });
  if (!latest) throw new AppError("STEP_UP_REQUIRED", "Confirm it is you before signing.", 403);
  if (latest.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("STEP_UP_EXPIRED", "That confirmation has expired. Confirm again.", 403);
  }
}
