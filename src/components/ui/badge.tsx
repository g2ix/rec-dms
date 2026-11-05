import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const tones: Record<string, StatusTone> = {
  default: "success",
  secondary: "draft",
  destructive: "danger",
  outline: "info",
  ghost: "draft",
  link: "info",
};

function Badge({
  variant = "default",
  children,
}: {
  variant?: keyof typeof tones;
  children: React.ReactNode;
  className?: string;
}) {
  return <StatusBadge tone={tones[variant] ?? "draft"} label={String(children)} />;
}

export { Badge };
