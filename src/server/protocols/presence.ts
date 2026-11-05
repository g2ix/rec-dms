import "server-only";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

export type PresenceViewer = { id: string; name: string };

/** Polled presence. Swap this for a websocket store later without changing the page. */
export interface PresenceStore {
  touch(userId: string, formInstanceId: string): Promise<PresenceViewer[]>;
}

const VISIBLE_MS = 20_000;

export function prismaPresenceStore(): PresenceStore {
  return {
    async touch(userId, formInstanceId) {
      const instance = await prisma.formInstance.findUnique({ where: { id: formInstanceId } });
      if (!instance || instance.ownerType !== "PROTOCOL_VERSION") {
        throw new AppError("NOT_FOUND", "That form was not found.", 404);
      }
      const version = await prisma.protocolVersion.findUnique({ where: { id: instance.ownerId } });
      if (!version) throw new AppError("NOT_FOUND", "That form was not found.", 404);
      const member = await prisma.protocolMember.findFirst({
        where: { protocolId: version.protocolId, userId, status: { not: "REMOVED" } },
      });
      if (!member) throw new AppError("FORBIDDEN", "You cannot open this form.", 403);
      const seenAt = new Date();
      await prisma.presence.upsert({
        where: { userId_formInstanceId: { userId, formInstanceId } },
        create: { userId, formInstanceId, seenAt },
        update: { seenAt },
      });
      const rows = await prisma.presence.findMany({
        where: {
          formInstanceId,
          userId: { not: userId },
          seenAt: { gte: new Date(seenAt.getTime() - VISIBLE_MS) },
        },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: { seenAt: "desc" },
      });
      return rows.map((row) => ({ id: row.user.id, name: row.user.displayName }));
    },
  };
}

export const presenceStore: PresenceStore = prismaPresenceStore();
