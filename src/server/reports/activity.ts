import "server-only";
import { describeActivity, type ActivitySentence } from "@/lib/dashboard/proponent";
import { prisma } from "@/server/db";

const ACTIONS = [
  "task.completed",
  "workflow.step_entered",
  "workflow.instance_completed",
  "protocol.member_invited",
  "protocol.member_accepted",
  "protocol.version_submitted",
  "protocol.revision_started",
];

export type ActivityEvent = ActivitySentence & { id: string; at: Date };

export async function recentActivity(userId: string, limit = 5): Promise<ActivityEvent[]> {
  const memberships = await prisma.protocolMember.findMany({
    where: { userId, role: "PROPONENT", status: { not: "REMOVED" } },
    select: { protocolId: true },
  });
  const protocolIds = [...new Set(memberships.map((membership) => membership.protocolId))];
  if (protocolIds.length === 0) return [];
  const [events, protocols] = await Promise.all([
    prisma.auditEvent.findMany({
      where: { protocolId: { in: protocolIds }, action: { in: ACTIONS } },
      orderBy: { occurredAt: "desc" },
      take: 40,
      select: {
        id: true,
        occurredAt: true,
        action: true,
        actingRole: true,
        actorUserId: true,
        protocolId: true,
        diff: true,
      },
    }),
    prisma.protocol.findMany({
      where: { id: { in: protocolIds } },
      select: { id: true, code: true },
    }),
  ]);
  const codes = new Map(protocols.map((protocol) => [protocol.id, protocol.code]));
  const lines: ActivityEvent[] = [];
  for (const event of events) {
    const sentence = describeActivity({
      action: event.action,
      actingRole: event.actingRole,
      actorUserId: event.actorUserId,
      viewerId: userId,
      code: event.protocolId ? codes.get(event.protocolId) ?? null : null,
      diff: event.diff,
    });
    if (!sentence) continue;
    lines.push({ id: event.id, at: event.occurredAt, ...sentence });
    if (lines.length === limit) break;
  }
  return lines;
}
