"use client";

export function RadioGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rec-radios">
      <legend className="label">{label}</legend>
      {children}
    </fieldset>
  );
}

export function Radio({
  label,
  ...props
}: { label: React.ReactNode } & Omit<React.ComponentProps<"input">, "type">) {
  return (
    <label className="rec-radio">
      <input type="radio" {...props} />
      <span className="rec-radio__dot" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
