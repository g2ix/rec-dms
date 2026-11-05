import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const STATUS: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "draft", label: "Draft" },
  SUBMITTED: { tone: "info", label: "Submitted" },
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
