"use client";

import { useRef, useState } from "react";
import { CircleAlert, CircleCheck, Upload } from "lucide-react";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { acceptFor, formatUploadLimit, useProtocolUpload } from "@/components/protocols/use-upload";

type FileRow = {
  id: string;
  kind: string;
  originalName: string;
  suggestedName: string | null;
  scanStatus: string;
  size: number;
  mime: string;
};

const KINDS = [
  { value: "MANUSCRIPT", label: "Manuscript" },
  { value: "COVER_LETTER", label: "Cover letter" },
  { value: "FEE_RECEIPT", label: "Fee receipt" },
  { value: "SUPPORTING", label: "Supporting file" },
] as const;

export function UploadsPanel({
  protocolId,
  files,
  suggestedManuscript,
  locked,
  feeStatus,
  maxBytes,
}: {
  protocolId: string;
  files: FileRow[];
  suggestedManuscript: string | null;
  locked: boolean;
  feeStatus: string | null;
  maxBytes: number;
}) {
  const { message, setMessage } = useProtocolUpload(protocolId);

  return (
    <div className="rec-stack">
      {suggestedManuscript ? (
        <p className="body-sm">
          Suggested manuscript file name: <span className="code">{suggestedManuscript}</span>. The original name is kept as well.
        </p>
      ) : null}
      {feeStatus ? (
        <p className="body-sm">
          Fee receipt: <StatusBadge tone={feeStatus === "VERIFIED" ? "success" : feeStatus === "REJECTED" ? "danger" : "info"} label={feeLabel(feeStatus)} />
        </p>
      ) : null}
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      <ul className="rec-methods">
        {files.length === 0 ? <li className="body">No files on this version yet.</li> : null}
        {files.map((file) => (
          <li key={file.id} className="rec-card rec-stack">
            <div className="rec-inline">
              <p className="label">{labelFor(file.kind)}</p>
              <StatusBadge
                tone={file.scanStatus === "INFECTED" ? "danger" : file.scanStatus === "CLEAN" ? "success" : "info"}
                label={file.scanStatus === "PENDING" ? "Scan pending" : file.scanStatus === "CLEAN" ? "Scan clear" : "Blocked"}
              />
            </div>
            <p className="body">{file.originalName}</p>
            {file.suggestedName ? <p className="caption rec-muted">Suggested name {file.suggestedName}</p> : null}
            <p className="caption rec-muted">{Math.ceil(file.size / 1024)} KB</p>
            {file.scanStatus === "PENDING" ? (
              <p className="caption">Waiting for the virus scan. REC Staff can open it, with a warning, until the scan finishes.</p>
            ) : null}
            {file.scanStatus === "INFECTED" ? (
              <p className="caption">This file is blocked. It cannot be downloaded or included in a submission.</p>
            ) : (
              <OpenStoredFileButton
                fileId={file.id}
                protocolId={protocolId}
                onWarning={setMessage}
                onError={setMessage}
              />
            )}
          </li>
        ))}
      </ul>
      {locked ? (
        <p className="body-sm">This version is submitted. Start a revision to upload a new file.</p>
      ) : (
        <section className="rec-stack" aria-labelledby="upload-heading">
          <div>
            <h2 id="upload-heading" className="label">
              Add files
            </h2>
            <p className="caption rec-muted">
              Drop a file on its box, or click the box to choose one. It uploads right away. Manuscript and cover letter must be PDF; a
              receipt or supporting file may be a PDF or an image. Limit {formatUploadLimit(maxBytes)}.
            </p>
          </div>
          <div className="rec-dropzones">
            {KINDS.map((item) => (
              <DropZone
                key={item.value}
                protocolId={protocolId}
                kind={item.value}
                label={item.label}
                multiple={item.value === "SUPPORTING"}
                existing={files.filter((file) => file.kind === item.value)}
                maxBytes={maxBytes}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

type ZoneState =
  | { phase: "idle" }
  | { phase: "uploading"; name: string; progress: number; index: number; total: number }
  | { phase: "done"; names: string[] }
  | { phase: "error"; message: string };

/** One box per file kind: drop or click to choose, uploads at once, shows progress and a done mark. */
function DropZone({
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
  existing: FileRow[];
  maxBytes: number;
}) {
  const input = useRef<HTMLInputElement>(null);
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
        id={`upload-${kind}`}
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
      <label htmlFor={`upload-${kind}`} className="rec-dropzone__body" aria-busy={uploading}>
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

function labelFor(kind: string): string {
  return KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function feeLabel(status: string): string {
  if (status === "VERIFIED") return "Fee verified";
  if (status === "REJECTED") return "Fee rejected";
  return "Fee pending";
}
