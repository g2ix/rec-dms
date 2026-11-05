export type MembershipFact = {
  role: string;
  isLeader: boolean;
  status: string;
};

export type ProtocolDecisionInput = {
  action: string;
  membership: MembershipFact | null;
  staff: boolean;
  userStatus: string;
};

const REVIEW_ROLES = new Set(["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "REVIEWER"]);

function isOpen(membership: MembershipFact | null): membership is MembershipFact {
  return membership?.status === "ACTIVE" || membership?.status === "INVITED";
}

function isConflicted(membership: MembershipFact | null): boolean {
  if (!membership || membership.status === "REMOVED") return false;
  return membership.role === "PROPONENT" || membership.role === "ADVISER";
}

/**
 * Protocol access from a membership row. The active-view cookie is not an input.
 * A proponent or adviser cannot review, chair, or verify the fee on that protocol.
 */
export function decideProtocolAction(input: ProtocolDecisionInput): "allow" | "deny" {
  const { action, membership, staff, userStatus } = input;
  const active = membership?.status === "ACTIVE" ? membership : null;
  if (isConflicted(membership) && (action === "protocol.review" || action === "protocol.panel" || action === "protocol.fee")) {
    return "deny";
  }

  switch (action) {
    case "protocol.view":
    case "protocol.download":
      return isOpen(membership) || staff ? "allow" : "deny";
    case "protocol.edit":
    case "protocol.upload":
      return active && (active.role === "PROPONENT" || active.role === "ADVISER") ? "allow" : "deny";
    case "protocol.members":
      return active?.isLeader && active.role === "PROPONENT" ? "allow" : "deny";
    case "protocol.submit":
      if (!active?.isLeader || active.role !== "PROPONENT") return "deny";
      return userStatus === "ACTIVE" ? "allow" : "deny";
    case "protocol.fee":
    case "protocol.panel":
      return staff ? "allow" : "deny";
    case "protocol.review":
      if (staff) return "allow";
      return active && REVIEW_ROLES.has(active.role) ? "allow" : "deny";
    default:
      return "deny";
  }
}
