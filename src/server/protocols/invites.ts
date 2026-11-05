import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { normalizeEmail } from "@/lib/email";
import { audit, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";

type Writer = Prisma.TransactionClient | typeof prisma;

function isRoot(db: Writer): db is typeof prisma {
  return db === prisma;
}

/**
 * When a person verifies an email, open invitations addressed to that email
 * attach to the account. The person still accepts before they can edit.
 */
export async function bindInvitesForEmail(userId: string, email: string, db: Writer = prisma): Promise<number> {
  const run = async (tx: Prisma.TransactionClient) => {
    const normalized = normalizeEmail(email);
    const invites = await tx.protocolMember.findMany({
      where: { invitedEmail: normalized, userId: null, status: "INVITED" },
    });
    let bound = 0;
    for (const invite of invites) {
      const taken = await tx.protocolMember.findFirst({
        where: { protocolId: invite.protocolId, userId, status: { not: "REMOVED" } },
      });
      if (taken) continue;
      await tx.protocolMember.update({ where: { id: invite.id }, data: { userId } });
      await tx.notification.create({
        data: {
          userId,
          type: "protocol.invite",
          payload: { protocolId: invite.protocolId, memberId: invite.id, role: invite.role },
        },
      });
      await audit.record(tx, {
        actorUserId: userId,
        action: AuditAction.inviteBound,
        entityType: "protocol_member",
        entityId: invite.id,
        protocolId: invite.protocolId,
        diff: diffOf({ userId: null }, { userId, email: normalized }),
      });
      bound += 1;
    }
    return bound;
  };
  if (isRoot(db)) return db.$transaction(run);
  return run(db);
}
