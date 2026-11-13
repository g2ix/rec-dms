/** The post-sign-in check. The middleware guard sends every signed-in page here until it passes. */
export const TOTP_PATH = "/app/account/security";

/** Five tries, then the post-sign-in check locks until the window ends. The modal counts the same window down. */
export const TOTP_CHALLENGE_LIMIT = { limit: 5, windowMs: 60_000 };

export const TOTP_CODE_LENGTH = 6;

/** Strip spaces and dashes from a typed or pasted code. */
export function cleanTotpCode(value: string): string {
  return value.replace(/[\s-]/g, "");
}
