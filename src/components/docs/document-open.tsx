"use client";

import { useCallback, useRef, useState } from "react";
import { DocumentViewer, type DocumentViewerDoc } from "@/components/docs/document-viewer";
import { Button } from "@/components/ui/button";
import { downloadFileAction } from "@/server/protocols/actions";
import { cn } from "@/lib/utils";

type StoredFileOpenProps = {
  fileId: string;
  protocolId: string;
  label?: string;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onWarning?: (warning: string) => void;
  onError?: (message: string) => void;
};

/** Opens a protocol file in the in-app viewer. Signed URLs refresh while the viewer stays open. */
export function OpenStoredFileButton({
  fileId,
  protocolId,
  label = "Open",
  className,
  variant = "secondary",
  onWarning,
  onError,
}: StoredFileOpenProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<DocumentViewerDoc | null>(null);

  const load = useCallback(async () => {
    const result = await downloadFileAction({ fileId, protocolId });
    if (!result.ok) {
      onError?.(result.message);
      return null;
    }
    if (result.warning) onWarning?.(result.warning);
    return {
      url: result.url,
      fileName: result.fileName,
      mime: result.mime,
      protocolCode: result.protocolCode,
    } satisfies DocumentViewerDoc;
  }, [fileId, protocolId, onError, onWarning]);

  async function open() {
    setBusy(true);
    const next = await load();
    setBusy(false);
    if (next) setDoc(next);
  }

  const refresh = useCallback(async () => {
    const next = await load();
    if (next) {
      setDoc(next);
      return next.url;
    }
    return null;
  }, [load]);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        className={className}
        onClick={() => void open()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? "Opening…" : label}
      </Button>
      <DocumentViewer
        open={doc != null}
        doc={doc}
        onClose={() => setDoc(null)}
        onRefreshUrl={refresh}
        returnFocusRef={triggerRef}
      />
    </>
  );
}

type OpenHrefProps = {
  href: string;
  label: string;
  fileName?: string;
  mime?: string;
  protocolCode?: string | null;
  inline?: boolean;
  ready?: string;
  className?: string;
};

/**
 * Fetches a same-origin document URL (form PDF, package) and opens it in the viewer when
 * `inline` is true; otherwise downloads it. Used for generated PDFs and Print.
 */
export function OpenDocumentHref({
  href,
  label,
  fileName = "document.pdf",
  mime = "application/pdf",
  protocolCode = null,
  inline = true,
  className,
}: OpenHrefProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [doc, setDoc] = useState<DocumentViewerDoc | null>(null);
  const blobUrl = useRef<string | null>(null);

  function revoke() {
    if (blobUrl.current) {
      URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = null;
    }
  }

  const fetchBlob = useCallback(async (): Promise<DocumentViewerDoc | null> => {
    const probeUrl = `${href}${href.includes("?") ? "&" : "?"}probe=1`;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const probe = await fetch(probeUrl);
      if (probe.status === 202) {
        await wait(3_000);
        continue;
      }
      if (!probe.ok) {
        setMessage("The PDF could not be prepared.");
        return null;
      }
      const file = await fetch(href);
      if (!file.ok) {
        setMessage("The PDF could not be downloaded.");
        return null;
      }
      const blob = await file.blob();
      revoke();
      const url = URL.createObjectURL(blob);
      blobUrl.current = url;
      const name = fileNameFrom(file) ?? fileName;
      const type = blob.type || mime;
      return { url, fileName: name, mime: type, protocolCode };
    }
    setMessage("The PDF is still being prepared. Try again in a minute.");
    return null;
  }, [href, fileName, mime, protocolCode]);

  async function run() {
    setPending(true);
    setMessage(null);
    try {
      const next = await fetchBlob();
      if (!next) return;
      if (inline) {
        setDoc(next);
        return;
      }
      const anchor = document.createElement("a");
      anchor.href = next.url;
      anchor.download = next.fileName;
      anchor.click();
      revoke();
    } finally {
      setPending(false);
    }
  }

  const refresh = useCallback(async () => {
    const next = await fetchBlob();
    if (next) {
      setDoc(next);
      return next.url;
    }
    return null;
  }, [fetchBlob]);

  return (
    <div className={cn("rec-stack", className)}>
      <button
        ref={triggerRef}
        type="button"
        className="rec-btn rec-btn--secondary"
        onClick={() => void run()}
        disabled={pending}
        aria-busy={pending}
      >
        <span>{pending ? "Preparing…" : label}</span>
      </button>
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      <DocumentViewer
        open={doc != null}
        doc={doc}
        onClose={() => {
          setDoc(null);
          revoke();
        }}
        onRefreshUrl={refresh}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}

function fileNameFrom(response: Response): string | null {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
