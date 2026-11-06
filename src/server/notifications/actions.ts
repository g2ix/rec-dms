"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";

const preferenceSchema = z.object({
  digest: z.enum(["IMMEDIATE", "DAILY"]),
});

const templateSchema = z.object({
  key: z.string().trim().min(1).max(80),
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  bodyMarkdown: z.string().trim().min(1, "Enter the message.").max(8000),
  channels: z.array(z.enum(["IN_APP", "EMAIL"])).min(1, "Choose at least one channel."),
});

export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markReadAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await markNotificationRead(id);
  revalidatePath("/app/notifications");
}

export async function markAllReadAction(): Promise<void> {
  await markAllNotificationsRead();
  revalidatePath("/app/notifications");
}

export async function saveNotificationPreference(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = preferenceSchema.safeParse({ digest: formData.get("digest") });
  if (!parsed.success) throw new AppError("INVALID", "Choose immediate or a daily digest.", 400);
  await prisma.notificationPreference.upsert({
    where: { userId: user.id },
    create: { userId: user.id, digest: parsed.data.digest },
    update: { digest: parsed.data.digest },
  });
  revalidatePath("/app/account/notifications");
}

export async function saveNotificationTemplate(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "notification.edit");
  const channels = formData.getAll("channels").map(String);
  const parsed = templateSchema.safeParse({
    key: formData.get("key"),
    subject: formData.get("subject"),
    bodyMarkdown: formData.get("bodyMarkdown"),
    channels,
  });
  if (!parsed.success) {
    throw new AppError("INVALID", parsed.error.issues[0]?.message ?? "Check the template.", 400);
  }
  const existing = await prisma.notificationTemplate.findUnique({ where: { key: parsed.data.key } });
  if (!existing) throw new AppError("NOT_FOUND", "That template was not found.", 404);
  await prisma.notificationTemplate.update({
    where: { key: parsed.data.key },
    data: {
      subject: parsed.data.subject,
      bodyMarkdown: parsed.data.bodyMarkdown,
      channels: parsed.data.channels,
    },
  });
  revalidatePath("/admin/notifications");
  revalidatePath(`/admin/notifications/${parsed.data.key}`);
}
