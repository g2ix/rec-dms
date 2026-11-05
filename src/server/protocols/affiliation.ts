import "server-only";
import type { AffiliationKind, ProtocolMemberRole } from "@prisma/client";
import { bindMembershipPrint, formatDesignation, type Affiliation } from "@/lib/affiliation";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

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
          contactEmailId: student.contactEmailId,
        }
      : null,
    faculty: faculty
      ? {
          position: faculty.position ?? "",
          unit: faculty.unit ?? "",
          institution: faculty.institution,
          contactEmailId: faculty.contactEmailId,
        }
      : null,
  };
}

export async function createProtocolForUser(userId: string, input: { title: string; affiliation: StoredAffiliation }) {
  const email = await ownedEmail(userId, input.affiliation.contactEmailId);
  return prisma.$transaction(async (tx) => {
    const protocol = await tx.protocol.create({
      data: { title: input.title.trim(), createdById: userId },
    });
    const member = await tx.protocolMember.create({
      data: {
        protocolId: protocol.id,
        userId,
        role: "PROPONENT",
        isLeader: true,
        rosterOrder: 1,
        contactEmailId: email.id,
        ...columns(input.affiliation),
      },
    });
    return { protocol, member };
  });
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
  if (!member) throw new AppError("NOT_FOUND", "That membership was not found.", 404);
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
