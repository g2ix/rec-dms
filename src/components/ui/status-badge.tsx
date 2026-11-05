import { Check, Clock, Pencil, RotateCcw, X } from "lucide-react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type StatusTone = "draft" | "info" | "warning" | "success" | "danger";

const icons = {
  draft: Pencil,
  info: Clock,
  warning: RotateCcw,
  success: Check,
  danger: X,
} as const;

export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={cn("rec-badge", `rec-badge--${tone}`)}>
      <Icon icon={icons[tone]} size={14} />
      {label}
    </span>
  );
}
