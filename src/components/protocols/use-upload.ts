"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmUploadAction, prepareUploadAction } from "@/server/protocols/actions";

/**
 * The protocol upload flow: prepare an intent (size limit and type checked on the server), PUT the
 * file to storage, then confirm it (which queues the virus scan). Shared by the Uploads tab and
 * the Documents section of the Intake page.
 */
export function useProtocolUpload(protocolId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(kind: string, file: File): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareUploadAction({ protocolId, kind, originalName: file.name, mime: file.type || "application/octet-stream" });
      if (!prepared.ok) {
        setMessage(prepared.message);
        return false;
      }
      const response = await fetch(prepared.url, { method: "PUT", headers: prepared.headers, body: file });
      if (!response.ok) {
        setMessage("The file could not be stored.");
        return false;
      }
      const confirmed = await confirmUploadAction({ intentId: prepared.intentId, protocolId });
      if (!confirmed.ok) {
        setMessage(confirmed.message);
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMessage("That did not go through. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { upload, busy, message, setMessage };
}

/** What the file input accepts for each kind. */
export function acceptFor(kind: string): string {
  return kind === "FEE_RECEIPT" || kind === "SUPPORTING" ? "application/pdf,image/jpeg,image/png,image/webp" : "application/pdf";
}

export function formatUploadLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const rounded = Number.isInteger(mb) ? String(mb) : mb.toFixed(1).replace(/\.0$/, "");
  return `${rounded} MB`;
}
