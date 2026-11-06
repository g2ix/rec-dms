import Link from "next/link";
import { BusyButton } from "@/components/ui/busy-button";
import { formatManila } from "@/lib/time";
import { listNotifications } from "@/server/notifications/inbox";
import { markAllReadAction, markReadAction } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await listNotifications(user.id);
  const unread = items.filter((item) => item.readAt == null).length;
  return (
    <article className="rec-stack">
      <h1 className="title">Notifications</h1>
      <p className="body rec-muted">Tasks, deadlines, and decisions for your account.</p>
      <div className="rec-actions">
        {unread > 0 ? (
          <form action={markAllReadAction}>
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
        <p className="body">No notifications yet.</p>
      ) : (
        <ul className="rec-stack">
          {items.map((item) => (
            <li key={item.id} className="rec-card rec-stack">
              <p className="label">
                {item.title || item.type}
                {item.readAt ? null : <span className="caption rec-muted"> Unread</span>}
              </p>
              {item.body ? <p className="body-sm">{item.body}</p> : null}
              <p className="caption rec-muted">{formatManila(item.createdAt, "d MMM yyyy, h:mm a")}</p>
              <div className="rec-actions">
                {item.link ? (
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
    </article>
  );
}
