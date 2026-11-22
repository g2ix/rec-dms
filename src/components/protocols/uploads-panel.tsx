"use client";

import { OpenStoredFileButton } from "@/components/docs/document-open";
import { DropZone } from "@/components/protocols/drop-zone";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatUploadLimit, useProtocolUpload } from "@/components/protocols/use-upload";

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

function labelFor(kind: string): string {
  return KINDS.find((item) => item.value === kind)?.label ?? kind;
}

function feeLabel(status: string): string {
  if (status === "VERIFIED") return "Fee verified";
  if (status === "REJECTED") return "Fee rejected";
  return "Fee pending";
}
