import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatManila } from "@/lib/time";

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "draft", label: "Draft" },
  SUBMITTED: { tone: "info", label: "Submitted" },
  INVITED: { tone: "warning", label: "Invitation" },
};

export function ProtocolList({
  rows,
  empty,
}: {
  rows: {
    id: string;
    title: string;
    code: string | null;
    status: string;
    version: string;
    updatedAt: Date;
    membershipStatus: string;
  }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="body">{empty}</p>;
  return (
    <div className="rec-proto-list">
      {rows.map((row) => {
        const key = row.membershipStatus === "INVITED" ? "INVITED" : row.status;
        const mapped = STATUS[key] ?? { tone: "draft" as const, label: row.status };
        return (
          <Link key={row.id} href={`/app/protocols/${row.id}`} className="rec-card rec-proto-card">
            <div className="rec-inline">
              <span className="code">{row.code ?? "Code not assigned"}</span>
              <span className="code">{row.version}</span>
              <StatusBadge tone={mapped.tone} label={mapped.label} />
            </div>
            <h2 className="heading">{row.title}</h2>
            <p className="caption rec-muted">Last activity {formatManila(row.updatedAt)}</p>
          </Link>
        );
      })}
    </div>
  );
}
