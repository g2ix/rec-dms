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
    },
  });
  if (!user) throw new AppError("NOT_FOUND", "That account was not found.", 404);
  return {
    exportedAt: new Date().toISOString(),
    profile: {
      id: user.id,
      firstName: user.firstName,
      middleInitial: user.middleInitial,
      familyName: user.familyName,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
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
