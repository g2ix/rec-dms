import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit, diffOf } from "@/server/audit";
import { AppError } from "@/server/errors";

type Tx = Prisma.TransactionClient;
type Meta = Parameters<typeof audit.record>[1]["meta"];

/** Moves a protocol to another active panel and records it. Does nothing when it is already there. */
export async function changePanelTx(tx: Tx, input: { protocolId: string; panelId: string; actorUserId: string; meta?: Meta }) {
  const panel = await tx.panel.findUnique({ where: { id: input.panelId } });
  if (!panel || !panel.active) throw new AppError("NOT_FOUND", "That panel was not found.", 404);
  const before = await tx.protocol.findUnique({ where: { id: input.protocolId }, select: { panelId: true } });
  if (!before) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
  if (before.panelId === panel.id) return;
  await tx.protocol.update({ where: { id: input.protocolId }, data: { panelId: panel.id } });
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    actingRole: "REC_STAFF",
    action: AuditAction.panelChanged,
    entityType: "protocol",
    entityId: input.protocolId,
    protocolId: input.protocolId,
    diff: diffOf({ panelId: before.panelId }, { panelId: panel.id }),
    meta: input.meta,
  });
}
