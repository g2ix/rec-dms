import { cn } from "@/lib/utils";

export function PlaceholderBar({
  width = "100%",
  className,
}: {
  width?: string;
  className?: string;
}) {
  return <span className={cn("rec-bar", className)} style={{ width }} />;
}
