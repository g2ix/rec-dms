/**
 * Lifetime of an Auth.js email sign-in link, in seconds.
 * The Nodemailer provider uses this as `maxAge`. The link is deleted when it is used.
 */
export const MAGIC_LINK_TTL_SECONDS = 24 * 60 * 60;

export function magicLinkLifetime(): string {
  const minutes = MAGIC_LINK_TTL_SECONDS / 60;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
