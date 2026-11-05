import { normalizeEmail } from "@/lib/email";

export const DEFAULT_AUTO_APPROVE_DOMAINS = ["usc.edu.ph"];

export function statusForEmail(
  email: string,
  domains: readonly string[] = DEFAULT_AUTO_APPROVE_DOMAINS,
): "ACTIVE" | "PENDING_APPROVAL" {
  const host = normalizeEmail(email).split("@")[1] ?? "";
  const approved = domains.some((domain) => {
    const normalized = domain.trim().toLowerCase().replace(/^@/, "");
    if (!normalized) return false;
    return host === normalized || host.endsWith(`.${normalized}`);
  });
  return approved ? "ACTIVE" : "PENDING_APPROVAL";
}
