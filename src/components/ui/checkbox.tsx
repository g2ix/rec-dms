"use client";

import { forwardRef } from "react";

export const Checkbox = forwardRef<
  HTMLInputElement,
  { label: React.ReactNode } & Omit<React.ComponentProps<"input">, "type">
>(function Checkbox({ label, ...props }, ref) {
  return (
    <label className="rec-check">
      <input ref={ref} type="checkbox" {...props} />
      <span className="rec-check__box" aria-hidden="true">
        <svg viewBox="0 0 12 12">
          <polyline points="2,6 5,9 10,3" />
        </svg>
      </span>
      <span>{label}</span>
    </label>
  );
});
