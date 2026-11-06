import "server-only";
import { prisma } from "@/server/db";
import { TEMPLATES } from "@/lib/notifications/catalog";

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, take = 50) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      readAt: true,
      createdAt: true,
      protocol: { select: { code: true, title: true } },
    },
  });
}

export async function latestNotifications(userId: string) {
  const [unread, items] = await Promise.all([unreadCount(userId), listNotifications(userId, 10)]);
  return { unread, items };
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
