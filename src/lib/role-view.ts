export const ROLE_VIEWS = ["proponent", "adviser", "reviewer", "panel-chair", "staff", "chair"] as const;

export type RoleView = (typeof ROLE_VIEWS)[number];

const ROLE_KEY_TO_VIEW: Record<string, RoleView> = {
  PROPONENT: "proponent",
  PROJECT_LEADER: "proponent",
  ADVISER: "adviser",
  PRIMARY_REVIEWER: "reviewer",
  INDEPENDENT_CONSULTANT: "reviewer",
  REC_MEMBER: "reviewer",
  PANEL_CHAIR: "panel-chair",
  REC_STAFF: "staff",
  MEMBER_SECRETARY: "staff",
  REC_CHAIR: "chair",
  SYSTEM_ADMIN: "chair",
};

export function knownRoleView(value: string | null | undefined): RoleView | null {
  if (!value) return null;
  return (ROLE_VIEWS as readonly string[]).includes(value) ? (value as RoleView) : null;
}

/** Shell views unlocked by role keys the account actually holds, in switcher order. */
export function viewsForRoleKeys(keys: Iterable<string>): RoleView[] {
  const unlocked = new Set<RoleView>();
  for (const key of keys) {
    const view = ROLE_KEY_TO_VIEW[key];
    if (view) unlocked.add(view);
  }
  return ROLE_VIEWS.filter((view) => unlocked.has(view));
}

const USC_ACADEMIC_LOCAL = /^[a-z]+(?:[.-][a-z]+)+$/i;

function isUscHost(host: string): boolean {
  return host === "usc.edu.ph" || host.endsWith(".usc.edu.ph");
}

/**
 * Views every account gets from who it is, before any granted role.
 * Every registrant can propose a protocol. A `firstname.lastname@usc.edu.ph`
 * address is faculty or staff, who can also advise. Being an adviser on a
 * protocol unlocks the adviser view for anyone.
 */
export function baseViews(input: { emails: Iterable<string>; advisesAProtocol: boolean }): RoleView[] {
  const unlocked = new Set<RoleView>(["proponent"]);
  if (input.advisesAProtocol) unlocked.add("adviser");
  for (const email of input.emails) {
    const [local, host] = email.trim().toLowerCase().split("@");
    if (local && host && isUscHost(host) && USC_ACADEMIC_LOCAL.test(local)) unlocked.add("adviser");
  }
  return ROLE_VIEWS.filter((view) => unlocked.has(view));
}
