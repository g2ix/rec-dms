import "server-only";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      emails: { orderBy: { email: "asc" } },
      memberships: {
        include: { protocol: { select: { id: true, code: true, title: true } } },
        orderBy: { createdAt: "asc" },
      },
      signatures: {
        select: { id: true, version: true, active: true, createdAt: true },
        orderBy: { version: "asc" },
      },
      profile: { include: { institution: true, school: true, department: true, office: true, program: true } },
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "That account was not found.", 404);
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      title: user.title,
      firstName: user.firstName,
      middleName: user.middleName,
      middleInitial: user.middleInitial,
      familyName: user.familyName,
      suffix: user.suffix,
      credentials: user.credentials,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      affiliation: user.profile
        ? {
            kind: user.profile.kind,
            academicLevel: user.profile.academicLevel,
            institution: user.profile.institution?.name || user.profile.institutionText,
            school: user.profile.school?.name ?? null,
            department: user.profile.department?.name ?? (user.profile.unitText || null),
            office: user.profile.office?.name ?? null,
            program: user.profile.program?.name || user.profile.programText || null,
            yearLabel: user.profile.yearLabel,
            position: user.profile.position,
          }
        : null,
    },
    emails: user.emails.map((email) => ({
      email: email.email,
      verifiedAt: email.verifiedAt?.toISOString() ?? null,
      isContact: email.isContact,
    })),
    memberships: user.memberships.map((member) => ({
      protocolId: member.protocolId,
      protocolCode: member.protocol.code,
      protocolTitle: member.protocol.title,
      role: member.role,
      status: member.status,
      isLeader: member.isLeader,
    })),
    signatures: user.signatures.map((signature) => ({
      id: signature.id,
      version: signature.version,
      active: signature.active,
      createdAt: signature.createdAt.toISOString(),
    })),
  };
}
