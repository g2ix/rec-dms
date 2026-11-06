import "server-only";
import { readTransaction, useAppSchema } from "@/server/db";
import { constrainPanel, reportScope } from "@/server/reports/access";

export async function searchProtocols(userId: string, query: string) {
  const text = query.trim();
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [];
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const scope = await reportScope(tx, userId);
    const panelId = constrainPanel(scope, undefined);
    return tx.protocol.findMany({
      where: {
        ...(panelId ? { panelId } : {}),
        OR: [
          { code: { contains: text, mode: "insensitive" } },
          { AND: words.map((word) => ({ title: { contains: word, mode: "insensitive" as const } })) },
          {
            members: {
              some: {
                role: "PROPONENT",
                status: { not: "REMOVED" },
                user: { AND: words.map((word) => ({ displayName: { contains: word, mode: "insensitive" as const } })) },
              },
            },
          },
        ],
      },
      take: 50,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        reviewType: true,
        panel: { select: { name: true } },
        members: {
          where: { role: "PROPONENT", status: { not: "REMOVED" } },
          select: { user: { select: { displayName: true } } },
          orderBy: { rosterOrder: "asc" },
          take: 4,
        },
      },
    });
  });
}
