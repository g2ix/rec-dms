"use client";

import { useRef } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { Icon } from "@/components/icons";
import { acceptFor, formatUploadLimit, useProtocolUpload } from "@/components/protocols/use-upload";
import { BusyButton } from "@/components/ui/busy-button";
import { StatusBadge } from "@/components/ui/status-badge";

type FileRow = { id: string; kind: string; originalName: string; scanStatus: string; size: number };

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
      <p className="body-sm rec-muted">PDF only. Limit {formatUploadLimit(maxBytes)} per file. Every file is scanned for viruses before reviewers see it.</p>
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      {required.length === 0 ? <p className="body-sm">No uploads are required at this step.</p> : null}
      <ul className="rec-doc-rows">
        {required.map((item) => {
          const file = files.find((row) => row.kind === item.kind) ?? null;
          return <DocumentRow key={item.kind} protocolId={protocolId} kind={item.kind} label={item.label} file={file} canUpload={canUpload} onMessage={setMessage} />;
        })}
      </ul>
      <p className="caption rec-muted">
        A fee receipt or supporting files go on the <Link href={`/app/protocols/${protocolId}/uploads`}>Uploads</Link> tab.
      </p>
    </div>
  );
}

function DocumentRow({
  protocolId,
  kind,
  label,
  file,
  canUpload,
  onMessage,
}: {
  protocolId: string;
  kind: string;
  label: string;
  file: FileRow | null;
  canUpload: boolean;
  onMessage: (message: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy, message } = useProtocolUpload(protocolId);
  return (
    <li className="rec-doc-row" data-testid={`document-${kind}`}>
      <div className="rec-doc-row__main">
        <p className="label">{label}</p>
        {file ? (
          <p className="body-sm rec-doc-row__name">{file.originalName}</p>
        ) : (
          <p className="body-sm rec-muted">Not uploaded yet</p>
        )}
        {message ? <p className="rec-field__error">{message}</p> : null}
      </div>
      <div className="rec-doc-row__actions">
        {file ? (
          <StatusBadge
            tone={file.scanStatus === "INFECTED" ? "danger" : file.scanStatus === "CLEAN" ? "success" : "info"}
            label={file.scanStatus === "PENDING" ? "Scan pending" : file.scanStatus === "CLEAN" ? "Scan clear" : "Blocked"}
          />
        ) : (
          <StatusBadge tone="draft" label="Missing" />
        )}
        {file && file.scanStatus !== "INFECTED" ? <OpenStoredFileButton fileId={file.id} protocolId={protocolId} onWarning={onMessage} onError={onMessage} /> : null}
        {canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={acceptFor(kind)}
              aria-label={`${file ? "Replace" : "Upload"} ${label}`}
              data-testid={`upload-${kind}`}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void upload(kind, chosen).then(() => (event.target.value = ""));
              }}
            />
            <BusyButton type="button" variant={file ? "secondary" : "primary"} busy={busy} busyLabel="Uploading…" onClick={() => input.current?.click()}>
              <Icon icon={Upload} size={16} />
              {file ? "Replace" : "Upload"}
            </BusyButton>
          </>
        ) : null}
      </div>
    </li>
  );
}
