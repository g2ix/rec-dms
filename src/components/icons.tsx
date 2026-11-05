import type { LucideIcon, LucideProps } from "lucide-react";

export function Icon({
  icon: IconComponent,
  size = 18,
  ...props
}: {
  icon: LucideIcon;
  size?: 14 | 16 | 18;
} & Omit<LucideProps, "size" | "strokeWidth">) {
  return <IconComponent aria-hidden="true" size={size} strokeWidth={1.75} {...props} />;
}
