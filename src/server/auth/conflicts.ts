const PARTY_ROLES = new Set(["PROPONENT", "ADVISER", "PROJECT_LEADER"]);
const REVIEWER_ROLES = new Set(["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"]);

const ROLE_LABEL: Record<string, string> = {
  PROPONENT: "proponent",
  ADVISER: "adviser",
  PROJECT_LEADER: "project leader",
  REVIEWER: "reviewer",
  PRIMARY_REVIEWER: "reviewer",
  INDEPENDENT_CONSULTANT: "independent consultant",
};

export function rolesConflict(left: string, right: string): boolean {
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  if (a === b) return false;
  return (PARTY_ROLES.has(a) && REVIEWER_ROLES.has(b)) || (REVIEWER_ROLES.has(a) && PARTY_ROLES.has(b));
}

export function roleLabel(role: string): string {
  return ROLE_LABEL[role.toUpperCase()] ?? role.toLowerCase().replaceAll("_", " ");
}

export function conflictMessage(
  items: { code: string | null; title: string; left: string; right: string }[],
): string {
  const detail = items
    .map((item) => {
      const protocol = item.code ? `${item.code} — ${item.title}` : item.title;
      return `${protocol} (${roleLabel(item.left)} and ${roleLabel(item.right)})`;
    })
    .join("; ");
  return `These accounts cannot be merged. Both belong to the same protocol in conflicting roles: ${detail}.`;
}
