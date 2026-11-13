import "server-only";
import type { Prisma } from "@prisma/client";
import { AppError } from "@/server/errors";

type Tx = Prisma.TransactionClient;

/** The caller's active proponent membership. Advisers and staff do not write the intake. */
export async function proponentOn(tx: Tx, protocolId: string, userId: string) {
  const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
  if (!member || member.role !== "PROPONENT") {
    throw new AppError("FORBIDDEN", "Only the proponents of this protocol can fill the intake.", 403);
  }
  return member;
}

export async function workingVersion(tx: Tx, protocolId: string) {
  const version = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
  if (!version) throw new AppError("LOCKED", "This version is submitted and cannot be edited.", 409);
  return version;
}
