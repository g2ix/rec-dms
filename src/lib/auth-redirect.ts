import { knownRoleView, type RoleView } from "@/lib/role-view";

export const SUSPENDED_SIGN_IN_MESSAGE = "Your account is suspended. Contact the REC Secretariat.";

export const APP_HOME = "/app";

const AUTH_ENTRY = new Set(["/", "/sign-in", "/sign-up"]);

export function isAuthEntryPath(pathname: string): boolean {
  return AUTH_ENTRY.has(pathname) || pathname === "/verify" || pathname.startsWith("/verify/");
}

export function isProtectedPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/") || pathname === "/admin" || pathname.startsWith("/admin/");
}

/** Email on `/verify` while a code is still outstanding. Any other `/verify` visit is an auth entry. */
export function verificationEmail(pathname: string, search: string): string | null {
  if (pathname !== "/verify" && !pathname.startsWith("/verify/")) return null;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const email = params.get("email")?.trim();
  return email || null;
}

/**
 * Same-site relative path only. Rejects protocol-relative (`//evil.com`),
 * absolute (`https://…`), and backslash tricks.
 */
export function safeCallbackPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return null;
  if (/[\s\\]/.test(candidate) || candidate.includes("://") || candidate.includes("\0")) return null;
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) return null;
  if (/[\s\\]/.test(decoded) || decoded.includes("://") || decoded.includes("\0")) return null;
  return candidate;
}

export function safeInternalPath(url: string, baseUrl: string): string {
  const relative = url.startsWith(baseUrl) ? url.slice(baseUrl.length) || "/" : url;
  return safeCallbackPath(relative) ?? "/";
}

/** Identity default view, then the last used view, then the app home. */
export function resolveStartPage(input: {
  identityDefaultView?: string | null;
  lastUsedView?: string | null;
}): { path: string; view: RoleView | null } {
  const view = knownRoleView(input.identityDefaultView) ?? knownRoleView(input.lastUsedView);
  return { path: APP_HOME, view };
}
