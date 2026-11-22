"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Upload } from "lucide-react";
import { Icon } from "@/components/icons";
import { acceptFor, formatUploadLimit, useProtocolUpload } from "@/components/protocols/use-upload";

type ZoneState =
  | { phase: "idle" }
  | { phase: "uploading"; name: string; progress: number; index: number; total: number }
  | { phase: "done"; names: string[] }
  | { phase: "error"; message: string };

/** One box per file kind: drop or click to choose, uploads at once, shows progress and a done mark. */
export function DropZone({
  protocolId,
  kind,
  label,
  multiple,
  existing,
  maxBytes,
}: {
  protocolId: string;
  kind: string;
  label: string;
  multiple: boolean;
  existing: { originalName: string }[];
  maxBytes: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = `upload-${kind}-${useId().replace(/:/g, "")}`;
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<ZoneState>({ phase: "idle" });
  const { upload, message } = useProtocolUpload(protocolId);
  const uploading = state.phase === "uploading";
  const accepted = acceptFor(kind).split(",");

  async function handle(list: FileList | null) {
    if (!list || list.length === 0 || uploading) return;
    const chosen = multiple ? Array.from(list) : [list[0]];
    const wrong = chosen.find((file) => !accepted.includes(file.type));
    if (wrong) {
      setState({ phase: "error", message: `${wrong.name} is not an accepted type for ${label.toLowerCase()}.` });
      return;
    }
    const tooBig = chosen.find((file) => file.size > maxBytes);
    if (tooBig) {
      setState({ phase: "error", message: `${tooBig.name} is over the ${formatUploadLimit(maxBytes)} limit.` });
      return;
    }
    const names: string[] = [];
    for (const [index, file] of chosen.entries()) {
      setState({ phase: "uploading", name: file.name, progress: 0, index, total: chosen.length });
      const ok = await upload(kind, file, (progress) =>
        setState({ phase: "uploading", name: file.name, progress, index, total: chosen.length }),
      );
      if (!ok) {
        setState({ phase: "error", message: "" });
        return;
      }
      names.push(file.name);
    }
    setState({ phase: "done", names });
  }

  const latest = existing[0] ?? null;
  // Once the refresh brings the stored file back, show its stored name (it may be renamed) instead of the local one.
  const latestName = latest?.originalName ?? null;
  const seen = useRef(latestName);
  useEffect(() => {
    if (latestName === seen.current) return;
    seen.current = latestName;
    if (!multiple) setState((current) => (current.phase === "done" ? { phase: "idle" } : current));
  }, [latestName, multiple]);
  const hasFile = state.phase === "done" || existing.length > 0;
  const zoneClass = [
    "rec-dropzone",
    dragging ? "rec-dropzone--over" : "",
    uploading ? "rec-dropzone--busy" : "",
    state.phase === "error" ? "rec-dropzone--error" : hasFile ? "rec-dropzone--done" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={zoneClass}
      data-testid={`dropzone-${kind}`}
      onDragEnter={(event) => {
        event.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        void handle(event.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        id={inputId}
        type="file"
        className="sr-only"
        accept={acceptFor(kind)}
        multiple={multiple}
        data-testid={`upload-${kind}`}
        disabled={uploading}
        onChange={(event) => {
          const target = event.currentTarget;
          void handle(target.files).then(() => (target.value = ""));
        }}
      />
      <label htmlFor={inputId} className="rec-dropzone__body" aria-busy={uploading}>
        <span className="rec-dropzone__icon" aria-hidden="true">
          <Icon icon={uploading ? Upload : state.phase === "error" ? CircleAlert : hasFile ? CircleCheck : Upload} size={18} />
        </span>
        <span className="rec-dropzone__text">
          <span className="label">{label}</span>
          <span className="caption rec-muted" aria-live="polite">
            {state.phase === "uploading"
              ? `Uploading ${state.name}${state.total > 1 ? ` (${state.index + 1} of ${state.total})` : ""} · ${Math.round(state.progress * 100)}%`
              : state.phase === "done"
                ? `Uploaded ${state.names.join(", ")}`
                : state.phase === "error"
                  ? state.message || message || "The upload did not go through."
                  : latest
                    ? `${existing.length > 1 ? `${existing.length} files · ` : ""}${latest.originalName}`
                    : dragging
                      ? "Drop to upload"
                      : multiple
                        ? "Drop files or click to choose"
                        : "Drop a file or click to choose"}
          </span>
        </span>
        {!uploading && hasFile ? <span className="caption rec-dropzone__action">{multiple ? "Add more" : "Replace"}</span> : null}
      </label>
      {uploading ? (
        <span className="rec-dropzone__bar" aria-hidden="true">
          <span style={{ width: `${Math.max(4, state.progress * 100)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
