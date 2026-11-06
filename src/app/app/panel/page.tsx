import Link from "next/link";
import { notFound } from "next/navigation";
import { protocolTone } from "@/components/reports/queue-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { AppError } from "@/server/errors";
import { panelProtocolList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "Panel protocols" };

export default async function PanelPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const user = await requireUser();
  try {
    const rows = await panelProtocolList(user.id, step);
    return (
      <article className="rec-stack">
        <h1 className="title">Panel protocols</h1>
        <p className="body rec-muted">{step ? `Open protocols at ${step}.` : "Open protocols in your panel."}</p>
        {rows.length === 0 ? <p className="body">No protocol is at this step.</p> : null}
        {rows.length > 0 ? (
          <div className="rec-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th scope="col">Protocol</th>
                  <th scope="col">Step</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/app/protocols/${row.id}`}>{row.title}</Link>
                      <p className="code">{row.code ?? "Code not assigned"}</p>
                    </td>
                    <td>{row.stepName}</td>
                    <td>
                      <StatusBadge tone={protocolTone(row.status)} label={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
