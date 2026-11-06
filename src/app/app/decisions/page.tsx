import { CountHeading, QueueTable } from "@/components/reports/queue-table";
import { inboxList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  const user = await requireUser();
  const waiting = await inboxList(user.id, "panel-chair");
  return (
    <article className="rec-stack">
      <h1 className="title">Decisions</h1>
      <CountHeading count={waiting.total} href="/app/tasks" label="waiting in this role" />
      <QueueTable rows={waiting.rows} empty="No decision is waiting." />
    </article>
  );
}
