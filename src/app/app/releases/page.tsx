import { notFound } from "next/navigation";
import { PageLinks, QueueTable } from "@/components/reports/queue-table";
import { AppError } from "@/server/errors";
import { listStepQueue } from "@/server/reports/dashboard";
import { requireUser } from "@/server/session";

export const metadata = { title: "Releases" };

export default async function ReleasesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const user = await requireUser();
  try {
    const queue = await listStepQueue(user.id, "release", Number(page ?? "1"));
    return (
      <article className="rec-stack">
        <h1 className="title">Releases</h1>
        <p className="body rec-muted">Decisions waiting for REC Staff to release.</p>
        <QueueTable rows={queue.rows} empty="No decision is waiting to be released." />
        <PageLinks page={queue.page} pages={queue.pages} href="/app/releases" />
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
}
