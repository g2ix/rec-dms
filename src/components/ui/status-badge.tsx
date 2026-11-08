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

export function StatusBadge({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  return (
    <span className={cn("rec-badge", `rec-badge--${tone}`, className)}>
      <Icon icon={icons[tone]} size={14} />
      {label}
    </span>
  );
}
