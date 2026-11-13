import "server-only";
import type { Prisma, ProtocolMemberRole } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { normalizeEmail } from "@/lib/email";
import { fallbackTemplate } from "@/lib/notifications/catalog";
import { applyVariables, markdownToText } from "@/lib/notifications/render";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { recordNotice } from "@/server/notifications/deliver";
import type { Mailer } from "@/server/auth/mailer";
import { defaultMailer } from "@/server/auth/mailer";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { bindInvitesForEmail } from "@/server/protocols/invites";

type Tx = Prisma.TransactionClient;

const INVITE_ROLES = new Set<ProtocolMemberRole>(["PROPONENT", "ADVISER"]);

async function requireLeader(tx: Tx, protocolId: string, userId: string) {
  const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
  if (!member?.isLeader || member.role !== "PROPONENT") {
    throw new AppError("FORBIDDEN", "Only the project leader can change the roster.", 403);
  }
  return member;
}

export async function inviteMember(
  input: { protocolId: string; actorUserId: string; email: string; role: ProtocolMemberRole },
  mailer: Mailer = defaultMailer(),
) {
  if (!INVITE_ROLES.has(input.role)) {
    throw new AppError("INVALID", "Invite a proponent or an adviser. Reviewers are assigned later.", 400);
  }
  const email = normalizeEmail(input.email);
  const meta = await auditRequestMeta({ email, role: input.role });
  const result = await prisma.$transaction(async (tx) => {
    await requireLeader(tx, input.protocolId, input.actorUserId);
    const protocol = await tx.protocol.findUnique({ where: { id: input.protocolId } });
    if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
    const existingEmail = await tx.protocolMember.findFirst({
      where: { protocolId: input.protocolId, invitedEmail: email, status: { not: "REMOVED" } },
    });
    if (existingEmail) throw new AppError("ALREADY_MEMBER", "That email is already on this protocol.", 409);

    const account = await tx.userEmail.findFirst({
      where: { email, verifiedAt: { not: null } },
      include: { user: true },
    });
    const removed = account
      ? await tx.protocolMember.findFirst({
          where: { protocolId: input.protocolId, userId: account.userId, status: "REMOVED" },
        })
      : null;
    const count = await tx.protocolMember.count({
      where: { protocolId: input.protocolId, status: { not: "REMOVED" } },
    });
    const data = {
      role: input.role,
      isLeader: false,
      rosterOrder: count + 1,
      status: "INVITED" as const,
      invitedEmail: email,
      invitedById: input.actorUserId,
      userId: account?.userId ?? null,
    };
    const member = removed
      ? await tx.protocolMember.update({ where: { id: removed.id }, data })
      : await tx.protocolMember.create({ data: { protocolId: input.protocolId, ...data } });
    if (account) {
      await recordNotice(tx, {
        userIds: [account.userId],
        templateKey: "invite.member",
        protocolId: input.protocolId,
        link: `/app/protocols/${input.protocolId}/members`,
        variables: {
          roleLabel: input.role === "ADVISER" ? "an adviser" : "a proponent",
          protocolTitle: protocol.title,
        },
        email: false,
      });
    }
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.memberInvited,
      entityType: "protocol_member",
      entityId: member.id,
      protocolId: input.protocolId,
      diff: diffOf({}, { email, role: input.role, userId: account?.userId ?? null }),
      meta,
    });
    return { member, protocol, knownUser: Boolean(account) };
  });

  const link = result.knownUser
    ? `${env.AUTH_URL}/app/protocols/${input.protocolId}/members`
    : `${env.AUTH_URL}/sign-up?email=${encodeURIComponent(email)}`;
  const template = fallbackTemplate("invite.member");
  const variables = {
    protocolTitle: result.protocol.title,
    roleLabel: input.role === "ADVISER" ? "an adviser" : "a proponent",
    link,
    recipientName: "",
  };
  await mailer.send({
    to: email,
    subject: applyVariables(template.subject, variables),
    text: markdownToText(applyVariables(template.bodyMarkdown, variables)),
  });
  return result.member;
}

export async function acceptInvite(input: {
  protocolId: string;
  userId: string;
  contactEmailId: string;
  contactNumber?: string | null;
  affiliationKind: "STUDENT" | "FACULTY";
  course?: string | null;
  yearLabel?: string | null;
  position?: string | null;
  unit?: string | null;
  institution: string;
  designation: string;
  profileKind?: string | null;
  academicLevel?: "UNDERGRADUATE" | "GRADUATE" | null;
  schoolName?: string | null;
  departmentName?: string | null;
  officeName?: string | null;
  programName?: string | null;
}) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const email = await tx.userEmail.findFirst({
      where: { id: input.contactEmailId, userId: input.userId, verifiedAt: { not: null } },
    });
    if (!email) throw new AppError("NOT_FOUND", "Choose one of your verified emails.", 400);
    await bindInvitesForEmail(input.userId, email.email, tx);
    const member = await tx.protocolMember.findFirst({
      where: { protocolId: input.protocolId, userId: input.userId, status: "INVITED" },
    });
    if (!member) throw new AppError("NOT_FOUND", "There is no invitation for you on this protocol.", 404);
    const updated = await tx.protocolMember.update({
      where: { id: member.id },
      data: {
        status: "ACTIVE",
        contactEmailId: email.id,
        contactNumber: input.contactNumber?.trim() || null,
        affiliationKind: input.affiliationKind,
        course: input.affiliationKind === "STUDENT" ? input.course : null,
        yearLabel: input.affiliationKind === "STUDENT" ? input.yearLabel : null,
        position: input.affiliationKind === "FACULTY" ? input.position : null,
        unit: input.affiliationKind === "FACULTY" ? input.unit : null,
        institution: input.institution,
        designation: input.designation,
        profileKind: input.profileKind ?? null,
        academicLevel: input.academicLevel ?? null,
        schoolName: input.schoolName ?? null,
        departmentName: input.departmentName ?? null,
        officeName: input.officeName ?? null,
        programName: input.programName ?? null,
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: member.role,
      action: AuditAction.memberAccepted,
      entityType: "protocol_member",
      entityId: member.id,
      protocolId: input.protocolId,
      diff: diffOf({ status: "INVITED" }, { status: "ACTIVE", designation: input.designation, email: email.email }),
      meta,
    });
    return updated;
  });
}

export async function removeMember(protocolId: string, actorUserId: string, memberId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const leader = await requireLeader(tx, protocolId, actorUserId);
    const member = await tx.protocolMember.findFirst({ where: { id: memberId, protocolId } });
    if (!member || member.status === "REMOVED") throw new AppError("NOT_FOUND", "That person is not on this protocol.", 404);
    if (member.id === leader.id) {
      throw new AppError("INVALID", "Transfer leadership before leaving the protocol.", 400);
    }
    await tx.protocolMember.update({
      where: { id: member.id },
      data: { status: "REMOVED", isLeader: false },
    });
    await audit.record(tx, {
      actorUserId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.memberRemoved,
      entityType: "protocol_member",
      entityId: member.id,
      protocolId,
      diff: diffOf({ status: member.status, role: member.role }, { status: "REMOVED" }),
      meta,
    });
  });
}

export async function transferLeadership(protocolId: string, actorUserId: string, memberId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const leader = await requireLeader(tx, protocolId, actorUserId);
    const next = await tx.protocolMember.findFirst({ where: { id: memberId, protocolId, status: "ACTIVE" } });
    if (!next || next.role !== "PROPONENT") {
      throw new AppError("INVALID", "Leadership can move only to an active proponent.", 400);
    }
    if (next.id === leader.id) return;
    const previousOrder = next.rosterOrder;
    await tx.protocolMember.update({ where: { id: next.id }, data: { isLeader: true, rosterOrder: 1 } });
    await tx.protocolMember.update({
      where: { id: leader.id },
      data: { isLeader: false, rosterOrder: previousOrder === 1 ? 2 : previousOrder },
    });
    await tx.protocol.update({ where: { id: protocolId }, data: { leaderUserId: next.userId ?? actorUserId } });
    await audit.record(tx, {
      actorUserId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.leadershipTransferred,
      entityType: "protocol",
      entityId: protocolId,
      protocolId,
      diff: diffOf({ leaderUserId: actorUserId }, { leaderUserId: next.userId }),
      meta,
    });
  });
}

export async function moveRoster(protocolId: string, actorUserId: string, memberId: string, direction: "up" | "down") {
  const meta = await auditRequestMeta({ direction });
  return prisma.$transaction(async (tx) => {
    await requireLeader(tx, protocolId, actorUserId);
    const members = await tx.protocolMember.findMany({
      where: { protocolId, status: { not: "REMOVED" } },
      orderBy: { rosterOrder: "asc" },
    });
    const leader = members.find((member) => member.isLeader);
    const rest = members.filter((member) => !member.isLeader);
    const index = rest.findIndex((member) => member.id === memberId);
    if (!leader || index < 0) throw new AppError("NOT_FOUND", "That person is not on the roster.", 404);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= rest.length) return;
    const current = rest[index]!;
    const neighbor = rest[swapIndex]!;
    await tx.protocolMember.update({ where: { id: leader.id }, data: { rosterOrder: 1 } });
    await tx.protocolMember.update({ where: { id: current.id }, data: { rosterOrder: swapIndex + 2 } });
    await tx.protocolMember.update({ where: { id: neighbor.id }, data: { rosterOrder: index + 2 } });
    const ordered = rest.map((member) => member.id);
    const moved = [...ordered];
    const [taken] = moved.splice(index, 1);
    moved.splice(swapIndex, 0, taken!);
    await audit.record(tx, {
      actorUserId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.rosterReordered,
      entityType: "protocol",
      entityId: protocolId,
      protocolId,
      diff: diffOf({ order: [leader.id, ...ordered] }, { order: [leader.id, ...moved] }),
      meta,
    });
  });
}
