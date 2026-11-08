import "server-only";
import { z } from "zod";
import { statusForEmail } from "@/lib/approval";
import { SUSPENDED_SIGN_IN_MESSAGE } from "@/lib/auth-redirect";
import { normalizeEmail } from "@/lib/email";
import { signUpSchema } from "@/lib/auth-schemas";
import { normalizeSuffix, normalizeTitle, parseCredentials, resolveMiddle } from "@/lib/name-parts";
import { AuditAction } from "@/lib/audit-log";
import { prisma } from "@/server/db";
import { audit, auditRequestMeta, diffOf, recordAudit } from "@/server/audit";
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
  middleName: z.string().nullable().optional(),
  familyName: z.string(),
  title: z.string().nullable().optional(),
  suffix: z.string().nullable().optional(),
  credentials: z.array(z.string()).optional(),
  passwordHash: z.string(),
});

export async function startRegistration(
  input: {
    firstName: string;
    middleInitial?: string;
    middleName?: string;
    title?: string;
    suffix?: string;
    credentials?: string;
    familyName: string;
    email: string;
    password: string;
  },
  mailer?: Mailer,
) {
  const parsed = signUpSchema.parse({
    ...input,
    middleName: input.middleName ?? input.middleInitial ?? "",
    title: input.title ?? "",
    suffix: input.suffix ?? "",
    credentials: input.credentials ?? "",
  });
  assertPasswordAcceptable(parsed.password, [parsed.firstName, parsed.familyName, parsed.email]);
  const email = normalizeEmail(parsed.email);
  const existing = await prisma.userEmail.findUnique({ where: { email } });
  if (existing) throw new AppError("EMAIL_TAKEN", "An account already uses this email. Sign in instead.", 409);
  const passwordHash = await hashPassword(parsed.password);
  const middle = resolveMiddle(parsed.middleName);
  await issueEmailCode({
    email,
    purpose: "VERIFY_EMAIL",
    mailer,
    payload: {
      firstName: parsed.firstName,
      middleInitial: middle.middleInitial,
      middleName: middle.middleName,
      familyName: parsed.familyName,
      title: normalizeTitle(parsed.title),
      suffix: normalizeSuffix(parsed.suffix),
      credentials: parseCredentials(parsed.credentials),
      passwordHash,
    },
  });
  await recordAudit({
    action: AuditAction.signUpStarted,
    entityType: "registration",
    entityId: email,
    meta: { email },
  });
  return { email };
}

export async function confirmRegistration(email: string, code: string) {
  const row = await verifyEmailCode({ email, purpose: "VERIFY_EMAIL", code });
  const payload = payloadSchema.safeParse(row.payload);
  if (!payload.success) throw new AppError("CODE_INVALID", "That code is not valid.", 400);
  const domains = await autoApproveDomains();
  const status = statusForEmail(normalizeEmail(email), domains);
  const meta = await auditRequestMeta();
  return prisma.$transaction(async (tx) => {
    const user = await createPerson(
      {
        firstName: payload.data.firstName,
        middleInitial: payload.data.middleInitial,
        middleName: payload.data.middleName,
        familyName: payload.data.familyName,
        title: payload.data.title,
        suffix: payload.data.suffix,
        credentials: payload.data.credentials,
        email,
        passwordHash: payload.data.passwordHash,
        status,
      },
      tx,
    );
    await audit.record(tx, {
      actorUserId: user.id,
      action: AuditAction.emailVerified,
      entityType: "user",
      entityId: user.id,
      diff: diffOf({}, { status: user.status, email: normalizeEmail(email) }),
      meta,
    });
    return user;
  });
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
  if (user.status === "SUSPENDED") {
    throw new AppError("SUSPENDED", SUSPENDED_SIGN_IN_MESSAGE, 403);
  }
  try {
    await assertCanAuthenticate(user.id);
  } catch {
    return null;
  }
  return user;
}
