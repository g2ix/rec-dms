export function ProgressRow({ label, value }: { label: string; value?: number }) {
  const determinate = typeof value === "number";
  return (
    <div className="rec-progress">
      <p className="label">{label}</p>
      <div
        className="rec-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? value : undefined}
      >
        <div
          className={determinate ? "rec-progress__bar" : "rec-progress__bar rec-progress__bar--sweep"}
          style={determinate ? { width: `${value}%` } : undefined}
        />
      </div>
    </div>
  );
}
