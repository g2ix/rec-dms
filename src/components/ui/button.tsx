import { cn } from "@/lib/utils";

type ButtonProps = React.ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "default" | "icon";
};

export function Button({
  variant = "secondary",
  size = "default",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn("rec-btn", `rec-btn--${variant}`, size === "icon" && "rec-btn--icon", className)}
      {...props}
    >
      <span>{children}</span>
    </button>
  );
}
