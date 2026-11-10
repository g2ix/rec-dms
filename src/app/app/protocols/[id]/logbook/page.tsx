import { notFound } from "next/navigation";
import { LogbookTable } from "@/components/docs/logbook-documents";
import { AppError } from "@/server/errors";
import { protocolLogbook } from "@/server/reports/logbook";
import { requireUser } from "@/server/session";

export const metadata = { title: "Logbook" };

export default async function LogbookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  try {
    const entries = await protocolLogbook(user.id, id);
    return (
      <section className="rec-stack">
        <h2 className="heading">Logbook</h2>
        <p className="body rec-muted">Workflow events, releases, notices, and generated documents.</p>
        {entries.length === 0 ? <p className="body">Nothing is recorded for this protocol yet.</p> : null}
        {entries.length > 0 ? <LogbookTable protocolId={id} entries={entries} /> : null}
      </section>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
}
