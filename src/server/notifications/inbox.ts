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
