import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { readJsonBody } from "@/server/request-body";
import { latestNotifications } from "@/server/notifications/inbox";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export async function GET() {
  try {
    const user = await requireUser();
    const latest = await latestNotifications(user.id);
    return NextResponse.json({
      unread: latest.unread,
      items: latest.items.map((item) => ({
        id: item.id,
        title: item.title || item.type,
        body: item.body,
        link: item.link,
        read: item.readAt != null,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    await requireUser();
    const parsed = bodySchema.safeParse((await readJsonBody(request)) ?? {});
    if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    if (parsed.data.all) await markAllNotificationsRead();
    else if (parsed.data.id) await markNotificationRead(parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
