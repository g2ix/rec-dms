import Link from "next/link";
import { cookies } from "next/headers";
import { OpenAsRole } from "@/components/notifications/open-as-role";
import { ROLE_LABEL } from "@/components/shell/nav";
import { BusyButton } from "@/components/ui/busy-button";
import { knownRoleView, type RoleView } from "@/lib/role-view";
import { formatManila } from "@/lib/time";
import { resolveRoleView } from "@/server/auth/view";
import { attentionByRole } from "@/server/notifications/attention";
import { listNotifications } from "@/server/notifications/inbox";
import { markAllReadAction, markReadAction } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Notifications" };

type Notice = Awaited<ReturnType<typeof listNotifications>>[number];

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const { role: roleParam } = await searchParams;
  const user = await requireUser();
  const { view: active, views } = await resolveRoleView(user.id, (await cookies()).get("activeView")?.value);
  const several = views.length > 1;
  const picked = knownRoleView(roleParam);
  const only: RoleView | "account" | null = roleParam === "account" ? "account" : picked && views.includes(picked) ? picked : null;
  const [items, attention] = await Promise.all([listNotifications(user.id, 100, "all"), attentionByRole(user.id, views)]);

  const roleOf = (item: Notice): RoleView | null => {
    const role = knownRoleView(item.roleView);
    return role && views.includes(role) ? role : null;
  };
  // Current role first, then the account, then the other roles.
  const order: (RoleView | null)[] = several ? [active, null, ...views.filter((view) => view !== active)] : [null];
  const sections = order
    .filter((key) => only === null || (only === "account" ? key === null : key === only))
    .map((key) => ({
      key,
      items: several ? items.filter((item) => roleOf(item) === key) : items,
      tasks: key ? (attention.roles.find((row) => row.view === key)?.tasks ?? 0) : 0,
      unread: key ? (attention.roles.find((row) => row.view === key)?.unread ?? 0) : attention.accountUnread,
    }))
    .filter((section) => only !== null || section.items.length > 0 || section.tasks > 0);
  const unread = attention.totalUnread;

  return (
    <article className="rec-stack">
      <h1 className="title">Notifications</h1>
      <p className="body rec-muted">
        {several
          ? "Everything waiting for you, in every role you hold. Opening one from another role switches you to that role."
          : "Tasks, deadlines, and decisions for your account."}
      </p>
      {several ? (
        <nav className="rec-segment rec-segment--wrap" aria-label="Show notifications for">
          <Link href="/app/notifications" aria-current={only === null ? "true" : undefined}>
            All roles{unread > 0 ? <span className="rec-segment__count rec-notice-count">{unread}</span> : null}
          </Link>
          {views.map((view) => {
            const row = attention.roles.find((item) => item.view === view);
            const count = (row?.unread ?? 0) + (row?.tasks ?? 0);
            return (
              <Link
                key={view}
                href={`/app/notifications?role=${view}`}
                aria-current={only === view ? "true" : undefined}
              >
                {ROLE_LABEL[view]}
                {count > 0 ? <span className="rec-segment__count rec-notice-count">{count}</span> : null}
              </Link>
            );
          })}
          <Link href="/app/notifications?role=account" aria-current={only === "account" ? "true" : undefined}>
            Account{attention.accountUnread > 0 ? <span className="rec-segment__count rec-notice-count">{attention.accountUnread}</span> : null}
          </Link>
        </nav>
      ) : null}
      <div className="rec-actions">
        {unread > 0 ? (
          <form action={markAllReadAction}>
            {only && only !== "account" ? <input type="hidden" name="view" value={only} /> : null}
            <BusyButton type="submit" variant="secondary" busyLabel="Marking…">
              {only && only !== "account" ? `Mark ${ROLE_LABEL[only]} read` : "Mark all read"}
            </BusyButton>
          </form>
        ) : null}
        <Link className="rec-btn rec-btn--ghost" href="/app/account/notifications">
          <span>Email preferences</span>
        </Link>
      </div>
      {sections.length === 0 ? <p className="body">No notifications yet.</p> : null}
      {sections.map((section) => {
        const title = section.key ? ROLE_LABEL[section.key] : "Your account";
        const otherRole = section.key && section.key !== active ? section.key : null;
        return (
          <section key={section.key ?? "account"} className="rec-notice-group" aria-label={title}>
            {several ? (
              <header className="rec-notice-group__head">
                <h2 className="subheading">
                  {title}
                  {section.key === active ? <span className="rec-notice-group__now">Current role</span> : null}
                </h2>
                <p className="caption rec-muted">
                  {[
                    section.unread > 0 ? `${section.unread} unread` : null,
                    section.tasks > 0 ? `${section.tasks} ${section.tasks === 1 ? "task" : "tasks"} waiting` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || (section.key ? "Nothing waiting" : "Notices about your account, shown in every role")}
                </p>
              </header>
            ) : null}
            {section.tasks > 0 ? (
              <div className="rec-notice-task">
                <p className="body-sm">
                  <strong>
                    {section.tasks} {section.tasks === 1 ? "task is" : "tasks are"} waiting
                  </strong>{" "}
                  for you as {title}.
                </p>
                {otherRole ? (
                  <OpenAsRole view={otherRole} label={ROLE_LABEL[otherRole]} href="/app/tasks" text="Open tasks" />
                ) : (
                  <Link className="rec-btn rec-btn--secondary" href="/app/tasks">
                    <span>Open tasks</span>
                  </Link>
                )}
              </div>
            ) : null}
            {section.items.length === 0 ? (
              section.tasks === 0 ? <p className="body-sm rec-muted">No notifications here.</p> : null
            ) : (
              <ul className="rec-stack">
                {section.items.map((item) => (
                  <li key={item.id} className="rec-card rec-stack rec-notice" data-unread={item.readAt ? undefined : "true"}>
                    <p className="label">
                      {item.title || item.type}
                      {item.readAt ? null : <span className="caption rec-notice__unread"> Unread</span>}
                    </p>
                    {item.body ? <p className="body-sm">{item.body}</p> : null}
                    <p className="caption rec-muted">{formatManila(item.createdAt, "d MMM yyyy, h:mm a")}</p>
                    <div className="rec-actions">
                      {item.link && otherRole ? (
                        <OpenAsRole view={otherRole} label={ROLE_LABEL[otherRole]} href={item.link} />
                      ) : item.link ? (
                        <Link className="rec-btn rec-btn--secondary" href={item.link}>
                          <span>Open</span>
                        </Link>
                      ) : null}
                      {item.readAt ? null : (
                        <form action={markReadAction}>
                          <input type="hidden" name="id" value={item.id} />
                          <button className="rec-btn rec-btn--ghost" type="submit">
                            <span>Mark read</span>
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </article>
  );
}
