"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { confirmUploadAction, prepareUploadAction } from "@/server/protocols/actions";

/** Uploads proof of payment against one open bill. The review does not wait for it. */
export function BillProofUpload({ protocolId, billId }: { protocolId: string; billId: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
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
      kind: "FEE_RECEIPT",
      billId,
      originalName: file.name,
      mime: file.type || "application/octet-stream",
    });
    if (!prepared.ok) {
      setBusy(false);
      setMessage(prepared.message);
      return;
    }
    const response = await fetch(prepared.url, { method: "PUT", headers: prepared.headers, body: file });
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
    form.current?.reset();
    setMessage("Proof of payment uploaded. REC Staff will check it.");
    router.refresh();
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="rec-form">
      <label className="rec-field">
        <span className="label">Proof of payment</span>
        <input className="rec-input" type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" required />
        <span className="rec-field__help">A PDF, or a JPEG, PNG, or WebP image of the receipt.</span>
      </label>
      {message ? (
        <p className="body-sm" role="status">
          {message}
        </p>
      ) : null}
      <BusyButton type="submit" busy={busy} busyLabel="Uploading…">
        Upload proof of payment
      </BusyButton>
    </form>
  );
}
