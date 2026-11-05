import "server-only";
import { assertBootstrapAdmin } from "@/server/auth/bootstrap";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { prismaMembershipReader, type ProtocolMembershipReader } from "@/server/authz/membership";
import { decideProtocolAction } from "@/server/authz/policy";
import { isCommitteeStaff } from "@/server/authz/staff";

const FORM_ACTIONS = new Set(["forms.view", "forms.edit", "forms.fill"]);

let reader: ProtocolMembershipReader = prismaMembershipReader();

/** Tests can substitute a reader. The app uses the Prisma reader. */
export function setProtocolMembershipReader(next: ProtocolMembershipReader): void {
  reader = next;
}

export type AuthzResource = {
  type?: string;
  id?: string;
  protocolId?: string;
};

function protocolIdOf(resource?: AuthzResource): string | undefined {
  if (resource?.protocolId) return resource.protocolId;
  if (resource?.type === "protocol" && resource.id) return resource.id;
  return undefined;
}

/**
 * One gate for server actions. Form administration stays with bootstrap admins
 * until M02 permissions exist. Protocol actions use membership rows.
 */
export async function authorize(
  user: { id: string },
  action: string,
  resource?: AuthzResource,
): Promise<void> {
  const protocolId = protocolIdOf(resource);
  if (protocolId && action.startsWith("protocol.")) {
    const [membership, staff, account] = await Promise.all([
      reader.forUser(user.id, protocolId),
      isCommitteeStaff(user.id),
      prisma.user.findUnique({ where: { id: user.id }, select: { status: true } }),
    ]);
    const decision = decideProtocolAction({
      action,
      membership,
      staff,
      userStatus: account?.status ?? "SUSPENDED",
    });
    if (decision === "allow") return;
    throw new AppError("FORBIDDEN", forbiddenMessage(action), 403);
  }

  if (!FORM_ACTIONS.has(action)) {
    throw new AppError("FORBIDDEN", "You cannot do that.", 403);
  }
  await assertBootstrapAdmin(user.id);
}

function forbiddenMessage(action: string): string {
  if (action === "protocol.submit") return "Only an approved project leader can submit this protocol.";
  if (action === "protocol.members") return "Only the project leader can change the roster.";
  if (action === "protocol.review") return "You cannot review a protocol you belong to as a proponent or adviser.";
  if (action === "protocol.fee" || action === "protocol.panel") return "Only REC Staff or a Chair can do that.";
  return "You cannot do that.";
}
