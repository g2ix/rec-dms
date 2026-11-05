export function BlurLoad({
  state,
  placeholder,
  children,
}: {
  state: "loading" | "ready" | "stale";
  placeholder?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rec-load" data-state={state} aria-busy={state === "ready" ? undefined : true}>
      <div className="rec-load__ph" aria-hidden="true">
        {placeholder}
      </div>
      <div className="rec-load__content">{children}</div>
    </div>
  );
}
