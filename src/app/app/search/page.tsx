import Link from "next/link";
import { notFound } from "next/navigation";
import { protocolTone } from "@/components/reports/queue-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { AppError } from "@/server/errors";
import { searchProtocols } from "@/server/reports/search";
import { requireUser } from "@/server/session";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const user = await requireUser();
  const query = q?.trim() ?? "";
  let rows: Awaited<ReturnType<typeof searchProtocols>> = [];
  if (query) {
    try {
      rows = await searchProtocols(user.id, query);
    } catch (error) {
      if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
      throw error;
    }
  }
  return (
    <article className="rec-stack">
      <h1 className="title">Search</h1>
      <form className="rec-filters" action="/app/search" method="get" role="search">
        <label className="rec-field rec-field--wide">
          <span className="rec-field__label">Protocol code, title, or proponent</span>
          <input className="rec-input" name="q" defaultValue={query} />
        </label>
        <div className="rec-actions">
          <button className="rec-btn rec-btn--primary" type="submit">
            <span>Search</span>
          </button>
        </div>
      </form>
      {!query ? <p className="body">Enter a protocol code, words from a title, or a proponent’s name.</p> : null}
      {query && rows.length === 0 ? <p className="body">No protocol matches that search.</p> : null}
      {rows.length > 0 ? (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Protocol</th>
                <th scope="col">Proponents</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/app/protocols/${row.id}`}>{row.title}</Link>
                    <p className="code">{row.code ?? "Code not assigned"}</p>
                    <p className="caption rec-muted">{row.panel?.name ?? "No panel"}</p>
                  </td>
                  <td>{row.members.map((member) => member.user?.displayName).filter(Boolean).join(", ") || "—"}</td>
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
}
