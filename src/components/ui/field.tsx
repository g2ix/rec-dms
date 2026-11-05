import { AlertCircle, Lock } from "lucide-react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type SaveState = "idle" | "saving" | "saved" | "conflict";

export function Field({
  label,
  help,
  optional = false,
  error,
  saveState = "idle",
  conflict,
  locked = false,
  lockedHref = "/app",
  htmlFor,
  children,
}: {
  label: string;
  help?: string;
  optional?: boolean;
  error?: string;
  saveState?: SaveState;
  conflict?: string;
  locked?: boolean;
  lockedHref?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const saveText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "conflict"
          ? conflict
          : null;

  return (
    <div className={cn("rec-field", error && "rec-field--error")}>
      <label className="rec-field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="rec-field__optional"> (optional)</span> : null}
      </label>
      {help ? <p className="rec-field__help">{help}</p> : null}
      {locked ? (
        <div className="rec-input rec-locked">
          <Icon icon={Lock} size={16} />
          <span>{children}</span>
        </div>
      ) : (
        children
      )}
      {locked ? (
        <p className="caption">
          <a href={lockedHref}>Edit in protocol details</a>
        </p>
      ) : null}
      {error ? (
        <p className="rec-field__error" role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{error}</span>
        </p>
      ) : saveText ? (
        <p className={cn("rec-save", saveState === "conflict" && "rec-save--conflict")} data-state={saveState}>
          {saveText}
        </p>
      ) : (
        <p className="rec-save" aria-hidden="true" />
      )}
    </div>
  );
}
