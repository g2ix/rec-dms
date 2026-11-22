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

  /** `onProgress` gets 0–1 as the file goes to storage. */
  async function upload(kind: string, file: File, onProgress?: (fraction: number) => void): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareUploadAction({ protocolId, kind, originalName: file.name, mime: file.type || "application/octet-stream" });
      if (!prepared.ok) {
        setMessage(prepared.message);
        return false;
      }
      const stored = await putWithProgress(prepared.url, prepared.headers, file, onProgress);
      if (!stored) {
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

/** PUT through XHR so the upload can report progress (fetch cannot). Rejects on a network error. */
function putWithProgress(url: string, headers: HeadersInit | undefined, file: File, onProgress?: (fraction: number) => void): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    new Headers(headers).forEach((value, key) => xhr.setRequestHeader(key, value));
    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      };
    }
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(file);
  });
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
