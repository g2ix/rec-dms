import "server-only";
import type { AffiliationKind, ProtocolMemberRole } from "@prisma/client";
import { bindMembershipPrint, formatDesignation, type Affiliation } from "@/lib/affiliation";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { ensureWorkingForms, openWorkingVersion } from "@/server/protocols/versions";
import { maybeStartInitial } from "@/server/workflow/engine";

type StoredAffiliation = Affiliation & { contactEmailId: string };

async function ownedEmail(userId: string, emailId: string) {
  const email = await prisma.userEmail.findFirst({
    where: { id: emailId, userId, verifiedAt: { not: null } },
  });
  if (!email) throw new AppError("NOT_FOUND", "Choose one of your verified emails.", 400);
  return email;
}

function columns(affiliation: Affiliation) {
  return {
    affiliationKind: affiliation.kind as AffiliationKind,
    course: affiliation.kind === "STUDENT" ? affiliation.course : null,
    yearLabel: affiliation.kind === "STUDENT" ? affiliation.yearLabel : null,
    position: affiliation.kind === "FACULTY" ? affiliation.position : null,
    unit: affiliation.kind === "FACULTY" ? affiliation.unit : null,
    institution: affiliation.institution,
    designation: formatDesignation(affiliation),
  };
}

export async function suggestAffiliation(userId: string) {
  const [emails, members] = await Promise.all([
    prisma.userEmail.findMany({
      where: { userId, verifiedAt: { not: null } },
      orderBy: [{ isContact: "desc" }, { createdAt: "asc" }],
    }),
    prisma.protocolMember.findMany({
      where: { userId, status: { not: "REMOVED" } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const student = members.find((member) => member.affiliationKind === "STUDENT") ?? null;
  const faculty = members.find((member) => member.affiliationKind === "FACULTY") ?? null;
  return {
    emails: emails.map((email) => ({ id: email.id, email: email.email, isContact: email.isContact })),
    student: student
      ? {
          course: student.course ?? "",
          yearLabel: student.yearLabel ?? "",
          institution: student.institution,
          contactEmailId: student.contactEmailId ?? "",
        }
      : null,
    faculty: faculty
      ? {
          position: faculty.position ?? "",
          unit: faculty.unit ?? "",
          institution: faculty.institution,
          contactEmailId: faculty.contactEmailId ?? "",
        }
      : null,
  };
}

export async function createProtocolForUser(
  userId: string,
  input: {
    title: string;
    affiliation: StoredAffiliation;
    disciplineId?: string | null;
    institutionAddress?: string;
    researchType?: string;
    durationMonths?: number | null;
    expectedParticipants?: number | null;
    studySite?: string;
    fundingSources?: { name: string }[];
    contactNumber?: string | null;
  },
) {
  const email = await ownedEmail(userId, input.affiliation.contactEmailId);
  const discipline = input.disciplineId
    ? await prisma.discipline.findUnique({ where: { id: input.disciplineId }, include: { panel: true } })
    : null;
  if (input.disciplineId && !discipline) throw new AppError("NOT_FOUND", "Choose a discipline.", 400);
  const meta = await auditRequestMeta({});
  const created = await prisma.$transaction(async (tx) => {
    const protocol = await tx.protocol.create({
      data: {
        title: input.title.trim(),
        createdById: userId,
        leaderUserId: userId,
        disciplineId: discipline?.id ?? null,
        panelId: discipline?.panelId ?? null,
        institution: input.affiliation.institution,
        institutionAddress: input.institutionAddress?.trim() ?? "",
        researchType: input.researchType?.trim() ?? "",
        durationMonths: input.durationMonths ?? null,
        expectedParticipants: input.expectedParticipants ?? null,
        studySite: input.studySite?.trim() ?? "",
        fundingSources: toJson(input.fundingSources ?? []),
        status: "DRAFT",
      },
    });
    const member = await tx.protocolMember.create({
      data: {
        protocolId: protocol.id,
        userId,
        role: "PROPONENT",
        isLeader: true,
        rosterOrder: 1,
        status: "ACTIVE",
        contactEmailId: email.id,
        invitedEmail: email.email,
        contactNumber: input.contactNumber?.trim() || null,
        ...columns(input.affiliation),
      },
    });
    const version = await openWorkingVersion(tx, protocol.id);
    await ensureWorkingForms(tx, version.id);
    await audit.record(tx, {
      actorUserId: userId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.protocolCreated,
      entityType: "protocol",
      entityId: protocol.id,
      protocolId: protocol.id,
      diff: diffOf({}, { title: protocol.title, disciplineId: protocol.disciplineId, panelId: protocol.panelId, version: version.label }),
      meta,
    });
    return { protocol, member, version };
  });
  await maybeStartInitial(created.protocol.id, created.version.id, userId);
  return created;
}

export async function joinProtocol(input: {
  userId: string;
  protocolId: string;
  role: ProtocolMemberRole;
  affiliation: StoredAffiliation;
}) {
  const email = await ownedEmail(input.userId, input.affiliation.contactEmailId);
  const protocol = await prisma.protocol.findUnique({ where: { id: input.protocolId } });
  if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
  const existing = await prisma.protocolMember.findUnique({
    where: { protocolId_userId: { protocolId: input.protocolId, userId: input.userId } },
  });
  if (existing && existing.status !== "REMOVED") {
    throw new AppError("ALREADY_MEMBER", "You are already on this protocol.", 409);
  }
  const count = await prisma.protocolMember.count({ where: { protocolId: input.protocolId } });
  const member = await prisma.protocolMember.create({
    data: {
      protocolId: input.protocolId,
      userId: input.userId,
      role: input.role,
      isLeader: false,
      rosterOrder: count + 1,
      contactEmailId: email.id,
      ...columns(input.affiliation),
    },
  });
  return member;
}

export async function membershipPrint(memberId: string) {
  const member = await prisma.protocolMember.findUnique({
    where: { id: memberId },
    include: { user: true, contactEmail: true },
  });
  if (!member?.user || !member.contactEmail || !member.affiliationKind) {
    throw new AppError("NOT_FOUND", "That membership was not found.", 404);
  }
  const affiliation =
    member.affiliationKind === "STUDENT"
      ? {
          kind: "STUDENT" as const,
          course: member.course ?? "",
          yearLabel: member.yearLabel ?? "",
          institution: member.institution,
        }
      : {
          kind: "FACULTY" as const,
          position: member.position ?? "",
          unit: member.unit ?? "",
          institution: member.institution,
        };
  return bindMembershipPrint({
    name: member.user.displayName,
    email: member.contactEmail.email,
    affiliation,
  });
}
