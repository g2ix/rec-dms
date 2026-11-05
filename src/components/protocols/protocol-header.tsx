import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "draft", label: "Draft" },
  Draft: { tone: "draft", label: "Draft" },
  SUBMITTED: { tone: "info", label: "Submitted" },
  Submitted: { tone: "info", label: "Submitted" },
  "Under Screening": { tone: "info", label: "Under screening" },
  "Under Review": { tone: "info", label: "Under review" },
  "Returned (incomplete)": { tone: "warning", label: "Returned (incomplete)" },
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
  status,
}: {
  code: string | null;
  title: string;
  version: string | null;
  status: string;
}) {
  const mapped = STATUS[status] ?? { tone: "draft" as const, label: status };
  return (
    <header className="rec-stack">
      <div className="rec-inline">
        <p className="code">{code ?? "Code not assigned"}</p>
        {version ? <p className="code">{version}</p> : null}
        <StatusBadge tone={mapped.tone} label={mapped.label} />
      </div>
      <h1 className="title">{title}</h1>
    </header>
  );
}
