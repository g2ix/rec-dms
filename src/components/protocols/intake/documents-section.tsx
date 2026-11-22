"use client";

import Link from "next/link";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { DropZone } from "@/components/protocols/drop-zone";
import { formatUploadLimit, useProtocolUpload } from "@/components/protocols/use-upload";
import { StatusBadge } from "@/components/ui/status-badge";

export type FileRow = { id: string; kind: string; originalName: string; scanStatus: string; size: number; tag?: string | null };

/**
 * The required uploads of this step, one row each: the latest file of that kind or an Upload
 * button. The same upload flow as the Uploads tab (size limit, file types, virus scan).
 */
export function DocumentsSection({
  protocolId,
  required,
  files,
  maxBytes,
  canUpload,
}: {
  protocolId: string;
  required: { kind: string; label: string }[];
  files: FileRow[];
  maxBytes: number;
  canUpload: boolean;
}) {
  const { message, setMessage } = useProtocolUpload(protocolId);
  return (
    <div className="rec-stack">
      <p className="body-sm rec-muted">Drop a PDF on its box, or click the box to choose one. It uploads right away. Limit {formatUploadLimit(maxBytes)} per file. Every file is scanned for viruses before reviewers see it.</p>
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      {required.length === 0 ? <p className="body-sm">No uploads are required at this step.</p> : null}
      <ul className="rec-doc-drops">
        {required.map((item) => {
          const file = files.find((row) => row.kind === item.kind) ?? null;
          return <DocumentRow key={item.kind} protocolId={protocolId} kind={item.kind} label={item.label} file={file} canUpload={canUpload} maxBytes={maxBytes} onMessage={setMessage} />;
        })}
      </ul>
      <p className="caption rec-muted">
        A fee receipt or supporting files go on the <Link href={`/app/protocols/${protocolId}/uploads`}>Uploads</Link> tab.
      </p>
    </div>
  );
}

export function DocumentRow({
  protocolId,
  kind,
  label,
  file,
  canUpload,
  maxBytes,
  onMessage,
}: {
  protocolId: string;
  kind: string;
  label: string;
  file: FileRow | null;
  canUpload: boolean;
  maxBytes: number;
  onMessage: (message: string | null) => void;
}) {
  return (
    <li className="rec-doc-drop" data-testid={`document-${kind}`}>
      {canUpload ? (
        <DropZone protocolId={protocolId} kind={kind} label={label} multiple={false} existing={file ? [file] : []} maxBytes={maxBytes} />
      ) : (
        <div className="rec-doc-drop__static">
          <p className="label">{label}</p>
          <p className="body-sm rec-doc-row__name">{file ? file.originalName : <span className="rec-muted">Not uploaded yet</span>}</p>
        </div>
      )}
      <div className="rec-doc-drop__meta">
        {file ? (
          <StatusBadge
            tone={file.scanStatus === "INFECTED" ? "danger" : file.scanStatus === "CLEAN" ? "success" : "info"}
            label={file.scanStatus === "PENDING" ? "Scan pending" : file.scanStatus === "CLEAN" ? "Scan clear" : "Blocked"}
          />
        ) : (
          <StatusBadge tone="draft" label="Missing" />
        )}
        {file?.tag ? <span className="caption rec-muted">{file.tag}</span> : null}
        {file && file.scanStatus !== "INFECTED" ? <OpenStoredFileButton fileId={file.id} protocolId={protocolId} onWarning={onMessage} onError={onMessage} /> : null}
      </div>
    </li>
  );
}
