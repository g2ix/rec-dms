"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuditAction } from "@/lib/audit-log";
import { cleanTotpCode, TOTP_CHALLENGE_LIMIT } from "@/lib/totp-challenge";
import { signTotpCookie } from "@/lib/totp-cookie";
import { env } from "@/lib/env";
import { audit, diffOf } from "@/server/audit";
import { rateLimiter } from "@/server/auth/rate-limit";
import { newTotpSecret, openSecret, sealSecret, totpCodeMatches, totpQrSvg, totpUri } from "@/server/auth/totp";
import { totpNextPath } from "@/server/auth/totp-gate";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

const PENDING = "recdms_totp_setup";
const SESSION = "recdms_totp";

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

async function rememberSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION, await signTotpCookie(userId, env.AUTH_SECRET), cookieOptions(12 * 60 * 60));
}

function fail(message: string): never {
  redirect(`/app/account/security?error=${encodeURIComponent(message)}`);
}

export async function beginTotpAction(): Promise<void> {
  await requireUser({ totp: false });
  const secret = newTotpSecret();
  const jar = await cookies();
  jar.set(PENDING, sealSecret(secret), cookieOptions(10 * 60));
  redirect("/app/account/security");
}

export async function confirmTotpAction(formData: FormData): Promise<void> {
  const user = await requireUser({ totp: false });
  const hit = await rateLimiter.hit(`totp:${user.id}`, 5, 5 * 60_000);
  if (!hit.ok) fail("Too many codes. Wait a few minutes and try again.");
  const parsed = z.string().trim().min(1).safeParse(formData.get("code"));
  if (!parsed.success) fail("Enter the 6-digit code.");
  const jar = await cookies();
  const pending = jar.get(PENDING)?.value;
  const secret = pending ? openSecret(pending) : null;
  if (!secret || !totpCodeMatches(secret, parsed.data)) {
    fail("That code did not match. Check the clock on your phone and try again.");
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { totpSecret: sealSecret(secret), totpEnabledAt: new Date() },
  });
  await prisma.$transaction(async (tx) => {
    await audit.record(tx, {
      actorUserId: user.id,
      action: AuditAction.settingChanged,
      entityType: "user",
      entityId: user.id,
      diff: diffOf({}, { totp: "enabled" }),
      meta: {},
    });
  });
  jar.delete(PENDING);
  await rememberSession(user.id);
  redirect("/app");
}

export type TotpChallengeResult =
  | { status: "ok"; next: string }
  | { status: "mismatch"; locked: boolean }
  | { status: "locked" }
  | { status: "not-enrolled" };

export async function challengeTotpAction(code: string, next: string): Promise<TotpChallengeResult> {
  const user = await requireUser({ totp: false });
  if (!user.totpSecret) return { status: "not-enrolled" };
  const hit = await rateLimiter.hit(`totp-challenge:${user.id}`, TOTP_CHALLENGE_LIMIT.limit, TOTP_CHALLENGE_LIMIT.windowMs);
  if (!hit.ok) return { status: "locked" };
  const parsed = z.string().regex(/^\d{6}$/).safeParse(cleanTotpCode(String(code)));
  const secret = openSecret(user.totpSecret);
  if (!parsed.success || !secret || !totpCodeMatches(secret, parsed.data)) {
    return { status: "mismatch", locked: hit.remaining === 0 };
  }
  await rememberSession(user.id);
  return { status: "ok", next: totpNextPath(next) };
}

type TotpSetup = { enrolled: boolean; uri: string | null; secret: string | null; qrSvg: string | null };

export async function totpSetup(): Promise<TotpSetup> {
  const user = await requireUser({ totp: false });
  if (user.totpEnabledAt) return { enrolled: true, uri: null, secret: null, qrSvg: null };
  const jar = await cookies();
  const pending = jar.get(PENDING)?.value;
  const secret = pending ? openSecret(pending) : null;
  if (!secret) return { enrolled: false, uri: null, secret: null, qrSvg: null };
  const uri = totpUri(user.email ?? "", secret);
  return { enrolled: false, uri, secret, qrSvg: await totpQrSvg(uri) };
}
