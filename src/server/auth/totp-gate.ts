import "server-only";
import { cookies } from "next/headers";
import { safeCallbackPath, isProtectedPath } from "@/lib/auth-redirect";
import { ROLE_KEY_LABEL } from "@/lib/forms/roles";
import { TOTP_PATH } from "@/lib/totp-challenge";
import { totpCookieValid } from "@/lib/totp-cookie";
import { env } from "@/lib/env";
import { STAFF_KEYS } from "@/server/authz/staff";

export { TOTP_PATH };

export const TOTP_SESSION_COOKIE = "recdms_totp";

/** "REC Staff, REC Chair, … and System admin" — the roles that must pass the check on every sign-in. */
export function totpRequiredRoles(): string {
  const labels = STAFF_KEYS.map((key) => ROLE_KEY_LABEL[key]);
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/** The page to open after the check. Only signed-in pages; never the check itself. */
export function totpNextPath(value: string | null | undefined): string {
  const path = safeCallbackPath(value);
  if (!path) return "/app";
  const pathname = path.split("?")[0] ?? "";
  if (!isProtectedPath(pathname) || pathname === TOTP_PATH) return "/app";
  return path;
}

/**
 * True while an enrolled user still owes the post-sign-in code. Mirrors the middleware guard;
 * the page uses it to render the locked shell instead of loading data.
 */
export async function totpCheckPending(user: { id: string; totpEnabledAt: Date | null }): Promise<boolean> {
  if (!user.totpEnabledAt) return false;
  const jar = await cookies();
  const ok = await totpCookieValid(jar.get(TOTP_SESSION_COOKIE)?.value, user.id, env.AUTH_SECRET);
  return !ok;
}
