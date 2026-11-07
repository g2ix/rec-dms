"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { confirmUploadAction, downloadFileAction, prepareUploadAction } from "@/server/protocols/actions";

type FileRow = {
  id: string;
  kind: string;
  originalName: string;
  suggestedName: string | null;
  scanStatus: string;
  size: number;
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
}: {
  protocolId: string;
  files: FileRow[];
  suggestedManuscript: string | null;
  locked: boolean;
  feeStatus: string | null;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]["value"]>("MANUSCRIPT");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("file");
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const prepared = await prepareUploadAction({
      protocolId,
      kind,
      originalName: file.name,
      mime: file.type || "application/octet-stream",
    });
    if (!prepared.ok) {
      setBusy(false);
      setMessage(prepared.message);
      return;
    }
    const response = await fetch(prepared.url, {
      method: "PUT",
      headers: prepared.headers,
      body: file,
    });
    if (!response.ok) {
      setBusy(false);
      setMessage("The file could not be stored.");
      return;
    }
    const confirmed = await confirmUploadAction({ intentId: prepared.intentId, protocolId });
    setBusy(false);
    if (!confirmed.ok) {
      setMessage(confirmed.message);
      return;
    }
    event.currentTarget.reset();
    router.refresh();
  }

  async function openFile(fileId: string) {
    const result = await downloadFileAction({ fileId, protocolId });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (result.warning) setMessage(result.warning);
    window.open(result.url, "_blank", "noopener");
  }

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
              <p className="caption">Waiting for the virus scan. REC Staff can download it, with a warning, until the scan finishes.</p>
            ) : null}
            {file.scanStatus === "INFECTED" ? (
              <p className="caption">This file is blocked. It cannot be downloaded or included in a submission.</p>
            ) : (
              <Button type="button" onClick={() => void openFile(file.id)}>
                Download
              </Button>
            )}
          </li>
        ))}
      </ul>
      {locked ? (
        <p className="body-sm">This version is submitted. Start a revision to upload a new file.</p>
      ) : (
        <form className="rec-form" onSubmit={(event) => void onSubmit(event)}>
          <Field label="Kind" htmlFor="upload-kind" help="Manuscript and cover letter must be PDF. A receipt may be a PDF or an image. Limit 25 MB.">
            <select id="upload-kind" className="rec-select" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              {KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="File" htmlFor="upload-file">
            <input id="upload-file" name="file" className="rec-input" type="file" required accept={kind === "FEE_RECEIPT" || kind === "SUPPORTING" ? "application/pdf,image/jpeg,image/png,image/webp" : "application/pdf"} />
          </Field>
          <BusyButton type="submit" variant="primary" busy={busy} busyLabel="Uploading…">
            Upload file
          </BusyButton>
        </form>
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
