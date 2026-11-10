import "server-only";
import { assertBootstrapAdmin } from "@/server/auth/bootstrap";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { prismaMembershipReader, type ProtocolMembershipReader } from "@/server/authz/membership";
import { canManageUsers, decideProtocolAction } from "@/server/authz/policy";
import { isCommitteeStaff } from "@/server/authz/staff";
import { userAdminFacts } from "@/server/authz/user-admin";

const FORM_ACTIONS = new Set([
  "forms.view",
  "forms.edit",
  "forms.fill",
  "workflow.view",
  "workflow.edit",
  "holiday.edit",
  "notification.edit",
]);

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

  if (action === "users.manage") {
    if (canManageUsers(await userAdminFacts(user.id))) return;
    throw new AppError("FORBIDDEN", "Only REC Staff or a System Admin can manage users.", 403);
  }
  if (action === "retention.review") {
    if (await isCommitteeStaff(user.id)) return;
    throw new AppError("FORBIDDEN", "Only REC Staff can review retention.", 403);
  }
  if (action === "task.reassign") {
    if (await isCommitteeStaff(user.id)) return;
    throw new AppError("FORBIDDEN", "Only REC Staff can reassign a task.", 403);
  }
  if (action === "task.complete" || action === "task.claim") {
    if (!resource?.id) throw new AppError("FORBIDDEN", "You cannot do that.", 403);
    const task = await prisma.task.findUnique({ where: { id: resource.id }, select: { assigneeUserId: true, status: true } });
    if (!task) throw new AppError("NOT_FOUND", "That task was not found.", 404);
    if (task.status === "COMPLETED") return;
    if (task.assigneeUserId && task.assigneeUserId !== user.id) {
      throw new AppError("FORBIDDEN", "This task is not assigned to you.", 403);
    }
    return;
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
