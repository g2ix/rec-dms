/**
 * Route handlers under `/api` that stay reachable while a session still owes the post-sign-in
 * authenticator check. Everything else under `/api` returns user data or changes state, so the
 * middleware refuses it until the check passes.
 *
 * - `/api/auth` runs sign-in and sign-out.
 * - `/api/session/end` signs out a session that can no longer be used.
 * - `/api/cron`, `/api/internal` and `/api/webhooks` authenticate with a bearer secret, not a session.
 * - `/api/health` reports service status and no user data.
 */
const TOTP_EXEMPT_PREFIXES = [
  "/api/auth",
  "/api/session/end",
  "/api/cron",
  "/api/internal",
  "/api/webhooks",
  "/api/health",
];

export const TOTP_REQUIRED_MESSAGE = "Enter the authenticator code first.";

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when this `/api` path must wait for the authenticator check. */
export function apiPathNeedsTotp(pathname: string): boolean {
  if (!isApiPath(pathname)) return false;
  return !TOTP_EXEMPT_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
}

/** A signed-in session owes the check when the token says so and no valid `recdms_totp` cookie is present. */
export function owesTotp(input: { userId: string | undefined; needsTotp: boolean; totpOk: boolean }): boolean {
  return Boolean(input.userId) && input.needsTotp && !input.totpOk;
}
