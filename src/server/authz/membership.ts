import "server-only";
import type { ProtocolMemberRole } from "@prisma/client";
import { prisma } from "@/server/db";

export type ProtocolMembershipView = {
  protocolId: string;
  memberId: string;
  userId: string;
  role: ProtocolMemberRole;
  isLeader: boolean;
  status: "INVITED" | "ACTIVE" | "REMOVED";
};

/** M02 left this as the seam. M05 reads `protocol_members`. */
export interface ProtocolMembershipReader {
  forUser(userId: string, protocolId: string): Promise<ProtocolMembershipView | null>;
}

function asStatus(value: string): ProtocolMembershipView["status"] {
  if (value === "INVITED" || value === "REMOVED") return value;
  return "ACTIVE";
}

export function prismaMembershipReader(): ProtocolMembershipReader {
  return {
    async forUser(userId, protocolId) {
      const row = await prisma.protocolMember.findFirst({
        where: { userId, protocolId },
        orderBy: { updatedAt: "desc" },
      });
      if (!row?.userId) return null;
      return {
        protocolId,
        memberId: row.id,
        userId: row.userId,
        role: row.role,
        isLeader: row.isLeader,
        status: asStatus(row.status),
      };
    },
  };
}
