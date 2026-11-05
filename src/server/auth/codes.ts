import "server-only";
import { createHash, randomInt } from "node:crypto";
import type { EmailCodePurpose, Prisma } from "@prisma/client";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Mailer } from "@/server/auth/mailer";
import { smtpMailer } from "@/server/auth/mailer";
import { CODE_SEND_LIMIT, rateLimiter } from "@/server/auth/rate-limit";

const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export function hashEmailCode(code: string): string {
  const secret = process.env.AUTH_SECRET ?? "";
  return createHash("sha256").update(`${secret}:${code}`).digest("hex");
}

function randomCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function messageFor(purpose: EmailCodePurpose, code: string): { subject: string; text: string } {
  const subject =
    purpose === "VERIFY_EMAIL"
      ? "Verify your REC-DMS email"
      : purpose === "LINK_EMAIL"
        ? "Confirm the email to link"
        : "Confirm it is you";
  return {
    subject,
    text: `Your REC-DMS code is ${code}. It expires in 15 minutes. If you did not ask for it, you can ignore this message.`,
  };
}

export async function issueEmailCode(input: {
  email: string;
  purpose: EmailCodePurpose;
  userId?: string;
  payload?: Prisma.InputJsonValue;
  mailer?: Mailer;
}): Promise<void> {
  const email = normalizeEmail(input.email);
  const hit = await rateLimiter.hit(`code:${email}`, CODE_SEND_LIMIT.limit, CODE_SEND_LIMIT.windowMs);
  if (!hit.ok) {
    throw new AppError("RATE_LIMITED", "Too many codes were sent to this email. Try again later.", 429);
  }
  const code = randomCode();
  await prisma.emailCode.create({
    data: {
      email,
      purpose: input.purpose,
      codeHash: hashEmailCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      userId: input.userId,
      payload: input.payload,
    },
  });
  const mail = messageFor(input.purpose, code);
  await (input.mailer ?? smtpMailer()).send({ to: email, ...mail });
}

export async function verifyEmailCode(input: { email: string; purpose: EmailCodePurpose; code: string }) {
  const email = normalizeEmail(input.email);
  const row = await prisma.emailCode.findFirst({
    where: { email, purpose: input.purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new AppError("CODE_INVALID", "That code is not valid.", 400);
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new AppError("CODE_EXPIRED", "That code has expired. Request a new one.", 400);
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    throw new AppError("CODE_LOCKED", "Too many attempts. Request a new code.", 400);
  }
  if (row.codeHash !== hashEmailCode(input.code.trim())) {
    const attempts = row.attempts + 1;
    await prisma.emailCode.update({ where: { id: row.id }, data: { attempts } });
    if (attempts >= MAX_CODE_ATTEMPTS) {
      throw new AppError("CODE_LOCKED", "Too many attempts. Request a new code.", 400);
    }
    throw new AppError("CODE_INVALID", "That code is not valid.", 400);
  }
  return prisma.emailCode.update({
    where: { id: row.id },
    data: { consumedAt: new Date() },
  });
}
