import "server-only";
import type { Prisma } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { prisma } from "@/server/db";
import { TEMPLATES } from "@/lib/notifications/catalog";

/** Notices for one role view, plus the ones not tied to a role. "all" (or no view) is every notice. */
function inView(userId: string, view?: RoleView | "all"): Prisma.NotificationWhereInput {
  if (!view || view === "all") return { userId };
  return { userId, OR: [{ roleView: view }, { roleView: null }] };
}

export async function unreadCount(userId: string, view?: RoleView | "all"): Promise<number> {
  return prisma.notification.count({ where: { ...inView(userId, view), readAt: null } });
}

export async function listNotifications(userId: string, take = 50, view?: RoleView | "all") {
  return prisma.notification.findMany({
    where: inView(userId, view),
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      roleView: true,
      readAt: true,
      createdAt: true,
      protocol: { select: { code: true, title: true } },
    },
  });
}

/** Unread notices waiting under the person's other roles, so the bell can point to them. */
export async function unreadInOtherViews(userId: string, view: RoleView, views: RoleView[]): Promise<{ view: RoleView; count: number }[]> {
  const others = views.filter((item) => item !== view);
  if (others.length === 0) return [];
  const rows = await prisma.notification.groupBy({
    by: ["roleView"],
    where: { userId, readAt: null, roleView: { in: others } },
    _count: { _all: true },
  });
  return others.flatMap((item) => {
    const count = rows.find((row) => row.roleView === item)?._count._all ?? 0;
    return count > 0 ? [{ view: item, count }] : [];
  });
}

export async function latestNotifications(userId: string, view?: RoleView, views: RoleView[] = []) {
  const [unread, items, elsewhere] = await Promise.all([
    unreadCount(userId, view),
    listNotifications(userId, 10, view),
    view ? unreadInOtherViews(userId, view, views) : Promise.resolve([]),
  ]);
  return { unread, items, elsewhere };
}

export async function preferenceFor(userId: string): Promise<"IMMEDIATE" | "DAILY"> {
  const row = await prisma.notificationPreference.findUnique({ where: { userId } });
  return row?.digest ?? "IMMEDIATE";
}

export async function ensureTemplates(): Promise<void> {
  for (const template of TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { key: template.key },
      create: {
        key: template.key,
        subject: template.subject,
        bodyMarkdown: template.bodyMarkdown,
        channels: template.channels,
        description: template.description,
        variables: template.variables,
      },
      update: {},
    });
  }
}

export async function listTemplates() {
  await ensureTemplates();
  return prisma.notificationTemplate.findMany({ orderBy: { key: "asc" } });
}
