import { notFound } from "next/navigation";
import { formatManila } from "@/lib/time";
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
        {entries.length > 0 ? (
          <div className="rec-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Kind</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Who</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.at.toISOString()}>{formatManila(entry.at)}</time>
                    </td>
                    <td>{entry.kind}</td>
                    <td>{entry.summary}</td>
                    <td>{entry.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) notFound();
    throw error;
  }
}
