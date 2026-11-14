import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { formatManila } from "@/lib/time";

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "draft", label: "Draft" },
  Draft: { tone: "draft", label: "Draft" },
  SUBMITTED: { tone: "info", label: "Submitted" },
  Submitted: { tone: "info", label: "Submitted" },
  "Under Screening": { tone: "info", label: "Under screening" },
  "Under Review": { tone: "info", label: "Under review" },
  "Returned (incomplete)": { tone: "warning", label: "Returned (incomplete)" },
  Returned: { tone: "warning", label: "Returned" },
  "With Adviser": { tone: "info", label: "With adviser" },
  "Awaiting Revision": { tone: "warning", label: "Awaiting revision" },
  Resubmitted: { tone: "info", label: "Resubmitted" },
  "Decision Released": { tone: "info", label: "Decision released" },
  Approved: { tone: "success", label: "Approved" },
  Exempted: { tone: "success", label: "Exempted" },
  Disapproved: { tone: "danger", label: "Disapproved" },
  Lapsed: { tone: "danger", label: "Lapsed" },
  Withdrawn: { tone: "danger", label: "Withdrawn" },
};

export function ProtocolHeader({
  code,
  title,
  version,
  versionNumber = null,
  status,
  leaderName = null,
  createdAt = null,
  actions = null,
}: {
  code: string | null;
  title: string;
  version: string | null;
  versionNumber?: number | null;
  status: string;
  leaderName?: string | null;
  createdAt?: Date | null;
  actions?: React.ReactNode;
}) {
  const mapped = STATUS[status] ?? { tone: "draft" as const, label: status };
  const kind = versionNumber == null ? null : versionNumber <= 1 ? "Initial submission" : `Resubmission ${versionNumber - 1}`;
  const facts = [
    kind,
    leaderName ? `Project leader: ${leaderName}` : null,
    createdAt ? `Created ${formatManila(createdAt, "d MMM yyyy")}` : null,
  ].filter((item): item is string => Boolean(item));
  return (
    <header className="rec-proto-head">
      <div className="rec-proto-head__main">
        <div className="rec-inline">
          <StatusBadge tone={mapped.tone} label={mapped.label} />
          <p className="code">
            {code ?? "No code yet"}
            {version ? <span className="rec-muted"> · {version}</span> : null}
          </p>
        </div>
        <h1 className="title">{title}</h1>
        {facts.length > 0 ? <p className="label rec-muted rec-proto-head__facts">{facts.join(" · ")}</p> : null}
      </div>
      {actions ? <div className="rec-proto-head__actions">{actions}</div> : null}
    </header>
  );
}
