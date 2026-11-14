import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { expect, type Page } from "@playwright/test";
import { authenticator } from "otplib";

/**
 * Committee staff (REC Staff, Chairs, System Admins) and any account with an authenticator owe the
 * "Confirm it is you" check after signing in. A fixture that signs in as one of them gets this
 * authenticator and passes the check, as a person would.
 */
export const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

/** Same sealing as src/server/auth/totp.ts, which is server-only. Needs AUTH_SECRET from `loadTestEnv`. */
export function sealTotpSecret(plain: string): string {
  const key = scryptSync(process.env.AUTH_SECRET ?? "", "recdms-totp-v1", 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

/** Turns the authenticator on for `userId` and clears its code rate limits. */
export async function enrollAuthenticator(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: sealTotpSecret(TOTP_SECRET), totpEnabledAt: new Date() } });
  await prisma.rateLimit.deleteMany({ where: { key: { in: [`totp-challenge:${userId}`, `totp:${userId}`] } } });
}

/** Enters the current code in the "Confirm it is you" dialog and waits for the page it was covering. */
export async function confirmItIsYou(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const first = page.getByRole("textbox", { name: "Digit 1 of 6" });
  await expect(first).toBeFocused();
  // The code submits itself once the sixth digit is in.
  await page.keyboard.type(authenticator.generate(TOTP_SECRET));
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}
