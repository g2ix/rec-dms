import Link from "next/link";
import { cookies } from "next/headers";
import { OpenAsRole } from "@/components/notifications/open-as-role";
import { ROLE_LABEL } from "@/components/shell/nav";
import { BusyButton } from "@/components/ui/busy-button";
import { knownRoleView } from "@/lib/role-view";
import { formatManila } from "@/lib/time";
import { resolveRoleView } from "@/server/auth/view";
import { listNotifications } from "@/server/notifications/inbox";
import { markAllReadAction, markReadAction } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const user = await requireUser();
  const { view: active, views } = await resolveRoleView(user.id, (await cookies()).get("activeView")?.value);
  const several = views.length > 1;
  // One role: every notice is that role's, so there is nothing to filter.
  const view = several && scope !== "all" ? active : "all";
  const items = await listNotifications(user.id, 50, view);
  const unread = items.filter((item) => item.readAt == null).length;
  return (
    <article className="rec-stack">
      <h1 className="title">Notifications</h1>
      <p className="body rec-muted">
        {!several
          ? "Tasks, deadlines, and decisions for your account."
          : view === "all"
            ? "Notifications for every role you hold. Each one says which role it is for."
            : `Notifications for your work as ${ROLE_LABEL[active]}, and those for your account.`}{" "}
        {several ? view === "all" ? <Link href="/app/notifications">This role only</Link> : <Link href="/app/notifications?scope=all">All my roles</Link> : null}
      </p>
      <div className="rec-actions">
        {unread > 0 ? (
          <form action={markAllReadAction}>
            {view === "all" ? null : <input type="hidden" name="view" value={view} />}
            <BusyButton type="submit" variant="secondary" busyLabel="Marking…">
              Mark all read
            </BusyButton>
          </form>
        ) : null}
        <Link className="rec-btn rec-btn--ghost" href="/app/account/notifications">
          <span>Email preferences</span>
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="body">{view === "all" ? "No notifications yet." : `No notifications for ${ROLE_LABEL[active]} yet.`}</p>
      ) : (
        <ul className="rec-stack">
          {items.map((item) => {
            const role = several ? knownRoleView(item.roleView) : null;
            const otherRole = role && role !== active ? role : null;
            return (
              <li key={item.id} className="rec-card rec-stack">
                <p className="label">
                  {item.title || item.type}
                  {item.readAt ? null : <span className="caption rec-muted"> Unread</span>}
                </p>
                {role ? <p className="caption rec-muted">For your role as {ROLE_LABEL[role]}</p> : null}
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
            );
          })}
        </ul>
      )}
    </article>
  );
}
