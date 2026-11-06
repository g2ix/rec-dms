import type { RoleView } from "@/lib/role-view";
import type { AssigneeRule } from "@/lib/workflow/graph";

/** Kinds matched after role rules. ROLE and PANEL_ROLE are matched by role key, not by this list. */
export const VIEW_KIND: Record<RoleView, AssigneeRule["kind"][]> = {
  proponent: ["PROTOCOL_LEADER", "PROTOCOL_PROPONENTS"],
  adviser: ["PROTOCOL_ADVISER"],
  reviewer: ["ASSIGNED_IN_STEP"],
  "panel-chair": ["PANEL_ROLE_OF_PROTOCOL"],
  staff: ["ROLE"],
  chair: ["ROLE"],
};

export const VIEW_ROLES: Record<RoleView, string[]> = {
  proponent: ["PROPONENT", "PROJECT_LEADER"],
  adviser: ["ADVISER"],
  reviewer: ["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "REC_MEMBER"],
  "panel-chair": ["PANEL_CHAIR"],
  staff: ["REC_STAFF", "MEMBER_SECRETARY"],
  chair: ["REC_CHAIR", "SYSTEM_ADMIN"],
};

export function taskMatchesView(rule: AssigneeRule | null, view: RoleView | "all"): boolean {
  if (view === "all") return true;
  if (!rule) return false;
  if (rule.kind === "USER") return true;
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    return VIEW_ROLES[view].includes(rule.role);
  }
  return VIEW_KIND[view].includes(rule.kind);
}
