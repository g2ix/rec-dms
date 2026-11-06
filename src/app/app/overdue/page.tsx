import { notFound } from "next/navigation";
import { PageLinks, QueueTable } from "@/components/reports/queue-table";
import { AppError } from "@/server/errors";
import { listStepQueue } from "@/server/reports/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "Overdue" };

export default async function OverduePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const user = await requireUser();
  try {
    const queue = await listStepQueue(user.id, "overdue", Number(page ?? "1"));
    return (
      <article className="rec-stack">
        <h1 className="title">Overdue</h1>
        <p className="body rec-muted">Open tasks past their deadline.</p>
        <QueueTable rows={queue.rows} empty="Nothing is overdue." />
        <PageLinks page={queue.page} pages={queue.pages} href="/app/overdue" />
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
}
