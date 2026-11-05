"use client";

export function Checkbox({
  label,
  ...props
}: { label: React.ReactNode } & Omit<React.ComponentProps<"input">, "type">) {
  return (
    <label className="rec-check">
      <input type="checkbox" {...props} />
      <span className="rec-check__box" aria-hidden="true">
        <svg viewBox="0 0 12 12">
          <polyline points="2,6 5,9 10,3" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
}
