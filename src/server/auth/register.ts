import "server-only";
import { z } from "zod";
import { statusForEmail } from "@/lib/approval";
import { normalizeEmail } from "@/lib/email";
import { signUpSchema } from "@/lib/auth-schemas";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { autoApproveDomains } from "@/server/auth/domains";
import { issueEmailCode, verifyEmailCode } from "@/server/auth/codes";
import type { Mailer } from "@/server/auth/mailer";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "@/server/auth/passwords";
import { createPerson } from "@/server/auth/users";
import { assertCanAuthenticate } from "@/server/auth/merge";

const payloadSchema = z.object({
  firstName: z.string(),
  middleInitial: z.string().nullable(),
  familyName: z.string(),
  passwordHash: z.string(),
});

export async function startRegistration(
  input: {
    firstName: string;
    middleInitial?: string;
    familyName: string;
    email: string;
    password: string;
  },
  mailer?: Mailer,
) {
  const parsed = signUpSchema.parse({
    ...input,
    middleInitial: input.middleInitial ?? "",
  });
  assertPasswordAcceptable(parsed.password, [parsed.firstName, parsed.familyName, parsed.email]);
  const email = normalizeEmail(parsed.email);
  const existing = await prisma.userEmail.findUnique({ where: { email } });
  if (existing) throw new AppError("EMAIL_TAKEN", "An account already uses this email. Sign in instead.", 409);
  const passwordHash = await hashPassword(parsed.password);
  await issueEmailCode({
    email,
    purpose: "VERIFY_EMAIL",
    mailer,
    payload: {
      firstName: parsed.firstName,
      middleInitial: parsed.middleInitial || null,
      familyName: parsed.familyName,
      passwordHash,
    },
  });
  // AUDIT: auth.sign_up_started
  return { email };
}

export async function confirmRegistration(email: string, code: string) {
  const row = await verifyEmailCode({ email, purpose: "VERIFY_EMAIL", code });
  const payload = payloadSchema.safeParse(row.payload);
  if (!payload.success) throw new AppError("CODE_INVALID", "That code is not valid.", 400);
  const domains = await autoApproveDomains();
  const status = statusForEmail(normalizeEmail(email), domains);
  const user = await createPerson({
    firstName: payload.data.firstName,
    middleInitial: payload.data.middleInitial,
    familyName: payload.data.familyName,
    email,
    passwordHash: payload.data.passwordHash,
    status,
  });
  // AUDIT: auth.email_verified
  return user;
}

export async function authenticatePassword(email: string, password: string) {
  const normalized = normalizeEmail(email);
  const row = await prisma.userEmail.findUnique({
    where: { email: normalized },
    include: { user: true },
  });
  const user = row?.user;
  if (!row?.verifiedAt || !user?.passwordHash) return null;
  const matches = await verifyPassword(user.passwordHash, password);
  if (!matches) return null;
  try {
    await assertCanAuthenticate(user.id);
  } catch {
    return null;
  }
  // AUDIT: auth.sign_in
  return user;
}
