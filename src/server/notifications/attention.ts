import "server-only";
import { Prisma } from "@prisma/client";
import { knownRoleView, type RoleView } from "@/lib/role-view";
import { prisma, useAppSchema } from "@/server/db";
import { openTasks } from "@/server/workflow/inbox";

/** What is waiting under one role: unread notices and open tasks. */
export type RoleAttention = { view: RoleView; unread: number; tasks: number };

export type Attention = {
  roles: RoleAttention[];
  /** Unread notices not tied to a role (account notices), shown under every role. */
  accountUnread: number;
  /** Every unread notice, whatever role it is for. */
  totalUnread: number;
};

/** Unread notices and open tasks for each of the person's roles, in switcher order. */
export async function attentionByRole(userId: string, views: RoleView[]): Promise<Attention> {
  const [grouped, taskCounts] = await Promise.all([
    prisma.notification.groupBy({
      by: ["roleView"],
      where: { userId, readAt: null },
      _count: { _all: true },
    }),
    taskCountsByView(userId, views),
  ]);
  let accountUnread = 0;
  let totalUnread = 0;
  const unreadByView = new Map<RoleView, number>();
  for (const row of grouped) {
    const count = row._count._all;
    totalUnread += count;
    const view = knownRoleView(row.roleView);
    // A notice for a role the person no longer holds still counts, under the account.
    if (view && views.includes(view)) unreadByView.set(view, (unreadByView.get(view) ?? 0) + count);
    else accountUnread += count;
  }
  return {
    roles: views.map((view) => ({ view, unread: unreadByView.get(view) ?? 0, tasks: taskCounts.get(view) ?? 0 })),
    accountUnread,
    totalUnread,
  };
}

async function taskCountsByView(userId: string, views: RoleView[]): Promise<Map<RoleView, number>> {
  const counts = new Map<RoleView, number>();
  if (views.length === 0) return counts;
  try {
    await prisma.$transaction(
      async (tx) => {
        await useAppSchema(tx);
        for (const view of views) {
          const { total } = await openTasks(tx, userId, view, 1);
          counts.set(view, total);
        }
      },
      { maxWait: 8_000, timeout: 20_000 },
    );
  } catch (error) {
    // A busy pool must not break the page; the counts are a hint.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") return counts;
    throw error;
  }
  return counts;
}
