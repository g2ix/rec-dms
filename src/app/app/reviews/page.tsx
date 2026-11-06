import { CountHeading, QueueTable } from "@/components/reports/queue-table";
import { completedReviewList, inboxList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "My reviews" };

export default async function ReviewsPage() {
  const user = await requireUser();
  const [open, completed] = await Promise.all([inboxList(user.id, "reviewer"), completedReviewList(user.id)]);
  return (
    <article className="rec-stack">
      <h1 className="title">My reviews</h1>
      <section className="rec-stack">
        <CountHeading count={open.total} href="/app/reviews" label="assigned reviews" />
        <QueueTable rows={open.rows} empty="No review is assigned to you." />
      </section>
      <section className="rec-stack" id="completed">
        <CountHeading count={completed.total} href="/app/reviews#completed" label="completed reviews" />
        <QueueTable rows={completed.rows} empty="You have not completed a review yet." />
      </section>
    </article>
  );
}
