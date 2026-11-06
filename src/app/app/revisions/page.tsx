import { CountHeading, QueueTable } from "@/components/reports/queue-table";
import { revisionList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "Revision deadlines" };

export default async function RevisionsPage() {
  const user = await requireUser();
  const list = await revisionList(user.id);
  return (
    <article className="rec-stack">
      <h1 className="title">Revision deadlines</h1>
      <CountHeading count={list.total} href="/app/revisions" label="waiting on you" />
      <QueueTable rows={list.rows} empty="No revision is waiting on you." />
    </article>
  );
}
