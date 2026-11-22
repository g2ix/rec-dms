import { knownRoleView, ROLE_VIEWS, type RoleView } from "@/lib/role-view";
import { assigneeRuleSchema, type AssigneeRule } from "@/lib/workflow/graph";
import { VIEW_KIND, VIEW_ROLES } from "@/lib/workflow/views";

/**
 * Notices that are always about one kind of work, whoever gets them. The first view in the list the
 * recipient holds wins. Notices not listed fall back to the task's rule, then to the recipient's
 * place on the protocol.
 */
const KEY_VIEWS: Record<string, RoleView[]> = {
  "task.escalated": ["staff", "chair", "panel-chair"],
  "fee.bill_not_issued": ["staff"],
  "conflict.declared": ["staff"],
  "retention.flagged": ["staff", "chair"],
  "review.redesignate": ["chair", "panel-chair"],
  "scan.unavailable": ["chair", "staff"],
  "audit.chain_broken": ["chair", "staff"],
  "revision.ready_for_adviser": ["adviser"],
  "protocol.returned_incomplete": ["proponent"],
  "fee.rejected": ["proponent"],
  "fee.bill_issued": ["proponent"],
  "intake.signatures_voided": ["proponent"],
};

/** Notices about a task go to the person who does it, not someone told about it. */
const NOT_FOR_TASK_DOER = new Set(["task.escalated", "review.submitted", "conflict.declared", "review.redesignate"]);

/** The views a task's assignee rule belongs to, most specific first. */
export function viewsOfRule(rule: AssigneeRule): RoleView[] {
  if (rule.kind === "FIRST_AVAILABLE") return [...new Set(rule.rules.flatMap((item) => viewsOfRule(item)))];
  if (rule.kind === "USER") return [];
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    return ROLE_VIEWS.filter((view) => VIEW_ROLES[view].includes(rule.role));
  }
  return ROLE_VIEWS.filter((view) => VIEW_KIND[view].includes(rule.kind));
}

export type NoticeRoleFacts = {
  templateKey: string;
  /** The role views the recipient can switch to. */
  held: RoleView[];
  /** The task's assignee rule, when the notice is about a task. */
  taskRule?: unknown;
  /** The recipient's active role on the protocol (PROPONENT, ADVISER), when the notice is about one. */
  memberRole?: string | null;
  /** Set by the sender when it knows which hat the recipient wears. */
  explicit?: string | null;
};

/**
 * Which role view a notice belongs to for one recipient, or null when it is not about a role (shown
 * in every role). An account with one view gets null too: there is nothing to choose between.
 */
export function noticeRoleView(facts: NoticeRoleFacts): RoleView | null {
  if (facts.held.length < 2) return null;
  const holds = (view: RoleView | null | undefined): view is RoleView => Boolean(view && facts.held.includes(view));
  const explicit = knownRoleView(facts.explicit);
  if (holds(explicit)) return explicit;
  const byKey = (KEY_VIEWS[facts.templateKey] ?? []).find(holds);
  if (byKey) return byKey;
  if (facts.taskRule != null && !NOT_FOR_TASK_DOER.has(facts.templateKey)) {
    const parsed = assigneeRuleSchema.safeParse(facts.taskRule);
    const byTask = parsed.success ? viewsOfRule(parsed.data).find(holds) : undefined;
    if (byTask) return byTask;
  }
  const byMembership: RoleView | null =
    facts.memberRole === "PROPONENT" ? "proponent" : facts.memberRole === "ADVISER" ? "adviser" : null;
  if (holds(byMembership)) return byMembership;
  return null;
}
