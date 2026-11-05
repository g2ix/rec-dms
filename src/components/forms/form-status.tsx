import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const LABELS: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "draft", label: "Draft" },
  PUBLISHED: { tone: "success", label: "Published" },
  RETIRED: { tone: "warning", label: "Retired" },
  COMPLETE: { tone: "success", label: "Complete" },
  LOCKED: { tone: "info", label: "Locked" },
};

export function FormStatusBadge({ status }: { status: string }) {
  const mapped = LABELS[status] ?? { tone: "draft" as const, label: status };
  return <StatusBadge tone={mapped.tone} label={mapped.label} />;
}
