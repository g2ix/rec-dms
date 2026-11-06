import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatManila } from "@/lib/time";
import type { QueueRow } from "@/server/reports/rows";

export function protocolTone(status: string): "draft" | "info" | "warning" | "success" | "danger" {
  const key = status.toLowerCase();
  if (key.includes("draft")) return "draft";
  if (key.includes("approv") || key === "exempted") return "success";
  if (key.includes("disapprov") || key.includes("lapse")) return "danger";
  if (key.includes("return") || key.includes("revision") || key.includes("await")) return "warning";
  return "info";
}

export function CountHeading({ count, href, label }: { count: number; href: string; label: string }) {
  return (
    <h2 className="heading">
      <Link href={href}>{count}</Link> {label}
    </h2>
  );
}

export function QueueTable({ rows, empty }: { rows: QueueRow[]; empty: string }) {
  if (rows.length === 0) return <p className="body">{empty}</p>;
  return (
    <div className="rec-table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th scope="col">Protocol</th>
            <th scope="col">Status</th>
            <th scope="col">Step</th>
            <th scope="col">With</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <Link href={row.href}>{row.title}</Link>
                <p className="code">{row.code ?? "Code not assigned"}</p>
              </td>
              <td>
                <StatusBadge tone={protocolTone(row.status)} label={row.status} />
              </td>
              <td>{row.step}</td>
              <td>{row.holder}</td>
              <td>
                {row.dueAt ? <p className="body-sm">{formatManila(row.dueAt, "d MMM yyyy")}</p> : <p className="body-sm rec-muted">No deadline</p>}
                {row.due === "overdue" ? <StatusBadge tone="danger" label="Overdue" /> : null}
                {row.due === "soon" ? <StatusBadge tone="warning" label="Due soon" /> : null}
                {row.note ? <p className="caption">{row.note}</p> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageLinks({ page, pages, href }: { page: number; pages: number; href: string }) {
  if (pages < 2) return null;
  const link = (next: number) => `${href}${href.includes("?") ? "&" : "?"}page=${next}`;
  return (
    <p className="body-sm rec-actions">
      {page > 1 ? <Link href={link(page - 1)}>Previous</Link> : <span className="rec-muted">Previous</span>}
      <span>
        Page {page} of {pages}
      </span>
      {page < pages ? <Link href={link(page + 1)}>Next</Link> : <span className="rec-muted">Next</span>}
    </p>
  );
}
