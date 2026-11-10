import type { AssigneeRule } from "@/lib/workflow/graph";

export type BlindingMember = { userId: string | null; role: string; status: string };

export const REVIEWER_LABEL = "Reviewer";

const REVIEWER_ROLES = new Set(["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"]);
const PROPONENT_ROLES = new Set(["PROPONENT", "ADVISER"]);

export function isReviewerRole(role: string): boolean {
  return REVIEWER_ROLES.has(role);
}

export function isProponentSideRole(role: string | undefined): boolean {
  return PROPONENT_ROLES.has(role ?? "");
}

export function onProponentSide(members: BlindingMember[], userId: string): boolean {
  return members.some((row) => row.userId === userId && row.status !== "REMOVED" && isProponentSideRole(row.role));
}

/** A proponent or adviser on the protocol stays blinded even when they also hold a committee role. */
export function seesReviewerNames(staff: boolean, members: BlindingMember[], userId: string): boolean {
  return staff && !onProponentSide(members, userId);
}

/** Whether this person acted as a reviewer, from the task's rule when it has one and otherwise their membership. */
export function isReviewerAuthor(rule: AssigneeRule | null, member: { role: string } | undefined): boolean {
  if (rule?.kind === "ROLE" || rule?.kind === "PANEL_ROLE_OF_PROTOCOL") return REVIEWER_ROLES.has(rule.role);
  return rule?.kind === "ASSIGNED_IN_STEP" || REVIEWER_ROLES.has(member?.role ?? "");
}
