import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ROLE_LABEL } from "@/components/shell/nav";
import { knownRoleView } from "@/lib/role-view";
import { resolveRoleView } from "@/server/auth/view";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { readJsonBody } from "@/server/request-body";
import { attentionByRole } from "@/server/notifications/attention";
import { listNotifications } from "@/server/notifications/inbox";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

/**
 * The bell: the latest notices for every role the person holds, each tagged with its role,
 * and what is waiting under each role, so nothing hides behind the role switcher.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const { view, views } = await resolveRoleView(user.id, (await cookies()).get("activeView")?.value);
    const [attention, items] = await Promise.all([attentionByRole(user.id, views), listNotifications(user.id, 20, "all")]);
    return NextResponse.json({
      unread: attention.totalUnread,
      view,
      accountUnread: attention.accountUnread,
      roles: attention.roles.map((item) => ({ ...item, label: ROLE_LABEL[item.view], current: item.view === view })),
      items: items.map((item) => {
        const role = knownRoleView(item.roleView);
        return {
          id: item.id,
          title: item.title || item.type,
          body: item.body,
          link: item.link,
          read: item.readAt != null,
          createdAt: item.createdAt.toISOString(),
          // Untagged notices, or ones for a role no longer held, belong to the account.
          view: role && views.includes(role) ? role : null,
        };
      }),
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
