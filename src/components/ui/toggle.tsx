"use client";

export function Toggle({
  label,
  ...props
}: { label: React.ReactNode } & Omit<React.ComponentProps<"input">, "type">) {
  return (
    <label className="rec-toggle">
      <input type="checkbox" role="switch" {...props} />
      <span className="rec-toggle__track" aria-hidden="true">
        <span className="rec-toggle__thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}
