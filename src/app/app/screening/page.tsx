import { notFound } from "next/navigation";
import { PageLinks, QueueTable } from "@/components/reports/queue-table";
import { AppError } from "@/server/errors";
import { listStepQueue } from "@/server/reports/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "Screening queue" };

export default async function ScreeningPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const user = await requireUser();
  try {
    const queue = await listStepQueue(user.id, "screening", Number(page ?? "1"));
    return (
      <article className="rec-stack">
        <h1 className="title">Screening queue</h1>
        <p className="body rec-muted">Submissions in the order they reached staff screening.</p>
        <QueueTable rows={queue.rows} empty="The screening queue is empty." />
        <PageLinks page={queue.page} pages={queue.pages} href="/app/screening" />
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
}
