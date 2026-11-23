/**
 * Who may grant which role, and how the roles are grouped on the person page.
 *
 * - Account roles (Proponent, Adviser) say what an approved account is for. REC Staff set them.
 * - Committee roles (panels, reviewers, members, REC offices) are appointments. Only the REC Chair sets them.
 * - System Admin is only granted by another System Admin.
 */

export type RoleGroup = "account" | "panel" | "committee" | "office" | "system";

export type GrantAuthority = "staff" | "chair" | "admin";

export type RoleInfo = {
  group: RoleGroup;
  authority: GrantAuthority;
  /** One line on the card, so a person knows what the role does before granting it. */
  blurb: string;
};

export const ROLE_INFO: Record<string, RoleInfo> = {
  PROPONENT: { group: "account", authority: "staff", blurb: "Submits protocols and answers the REC." },
  ADVISER: { group: "account", authority: "staff", blurb: "Advises proponents and endorses their submissions." },
  PANEL_CHAIR: { group: "panel", authority: "chair", blurb: "Leads the panel and receives its chair tasks." },
  PANEL_VICE_CHAIR: { group: "panel", authority: "chair", blurb: "Stands in for the Panel Chair." },
  PANEL_SECRETARY: { group: "panel", authority: "chair", blurb: "Keeps the panel's minutes and records." },
  PANEL_MEMBER: { group: "panel", authority: "chair", blurb: "Reviews protocols assigned to the panel." },
  PRIMARY_REVIEWER: { group: "committee", authority: "chair", blurb: "Can be assigned as primary reviewer on any protocol." },
  INDEPENDENT_CONSULTANT: { group: "committee", authority: "chair", blurb: "Gives an outside opinion when a protocol needs one." },
  REC_MEMBER: { group: "committee", authority: "chair", blurb: "Votes in full-board meetings." },
  MEMBER_SECRETARY: { group: "committee", authority: "chair", blurb: "Prepares meeting agendas and minutes." },
  REC_STAFF: { group: "office", authority: "chair", blurb: "Runs the REC office: screening, fees, accounts." },
  REC_CHAIR: { group: "office", authority: "chair", blurb: "Signs decisions and appoints the committee." },
  SYSTEM_ADMIN: { group: "system", authority: "admin", blurb: "Edits forms, workflows, and system settings." },
};

/** Roles granted on the account. Project Leader only exists on a protocol, so it is not here. */
export const ACCOUNT_ROLE_KEYS = ["PROPONENT", "ADVISER"] as const;
export type AccountRoleKey = (typeof ACCOUNT_ROLE_KEYS)[number];

export function isAccountRole(key: string): key is AccountRoleKey {
  return (ACCOUNT_ROLE_KEYS as readonly string[]).includes(key);
}

export function isManagedRole(key: string): boolean {
  return key in ROLE_INFO;
}

export type GrantorFacts = { roleKeys: ReadonlySet<string>; actsAsSystemAdmin: boolean };

export function canGrantAs(facts: GrantorFacts, authority: GrantAuthority): boolean {
  if (facts.actsAsSystemAdmin) return true;
  if (authority === "admin") return false;
  if (authority === "chair") return facts.roleKeys.has("REC_CHAIR");
  return facts.roleKeys.has("REC_STAFF") || facts.roleKeys.has("REC_CHAIR");
}

export function canGrantRole(facts: GrantorFacts, roleKey: string): boolean {
  const info = ROLE_INFO[roleKey];
  return info ? canGrantAs(facts, info.authority) : false;
}

export const AUTHORITY_LABEL: Record<GrantAuthority, string> = {
  staff: "REC Staff",
  chair: "the REC Chair",
  admin: "a System Admin",
};

export const GROUP_TITLE: Record<RoleGroup, string> = {
  account: "Account type",
  panel: "Panel roles",
  committee: "Committee roles",
  office: "REC office",
  system: "System",
};

export const GROUP_ORDER: RoleGroup[] = ["account", "panel", "committee", "office", "system"];
