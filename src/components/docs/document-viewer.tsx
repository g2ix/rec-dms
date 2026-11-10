"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { SIGNED_URL_REFRESH_MS, viewerKindFor, type ViewerKind } from "@/lib/docs/viewer";
import { cn } from "@/lib/utils";

export type DocumentViewerDoc = {
  url: string;
  fileName: string;
  mime: string;
  protocolCode?: string | null;
};

type DocumentViewerProps = {
  open: boolean;
  doc: DocumentViewerDoc | null;
  onClose: () => void;
  /** Called before the signed URL expires so the viewer can keep showing the file. */
  onRefreshUrl?: () => Promise<string | null>;
  /** Element that opened the viewer; focus returns here on close. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
};

export function DocumentViewer({
  open,
  doc,
  onClose,
  onRefreshUrl,
  returnFocusRef,
  className,
}: DocumentViewerProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const historyPushed = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);

  useEffect(() => {
    setUrl(doc?.url ?? null);
    setPdfFailed(false);
  }, [doc?.url, open]);

  useEffect(() => {
    if (!open || !onRefreshUrl) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const next = await onRefreshUrl();
        if (next) setUrl(next);
      })();
    }, SIGNED_URL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [open, onRefreshUrl]);

  useEffect(() => {
    if (!open) return;
    if (!historyPushed.current) {
      window.history.pushState({ recDocumentViewer: true }, "");
      historyPushed.current = true;
    }
    function onPopState() {
      if (!historyPushed.current) return;
      historyPushed.current = false;
      onClose();
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [open, onClose]);

  const dismiss = useCallback(() => {
    if (historyPushed.current) {
      historyPushed.current = false;
      window.history.back();
    }
    onClose();
  }, [onClose]);

  function handleOpenChange(next: boolean) {
    if (!next) dismiss();
  }

  const kind = doc ? viewerKindFor(doc.mime, doc.fileName) : "download";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="rec-scrim rec-doc-viewer__scrim" />
        <DialogPrimitive.Viewport className="rec-doc-viewer__viewport">
          <DialogPrimitive.Popup
            className={cn("rec-doc-viewer", className)}
            aria-labelledby={titleId}
            initialFocus={closeRef}
            finalFocus={returnFocusRef ?? true}
            data-testid="document-viewer"
          >
            <header className="rec-doc-viewer__bar">
              <div className="rec-doc-viewer__meta">
                <DialogPrimitive.Title id={titleId} className="subheading rec-doc-viewer__title">
                  {doc?.fileName ?? "Document"}
                </DialogPrimitive.Title>
                {doc?.protocolCode ? <p className="code rec-doc-viewer__code">{doc.protocolCode}</p> : null}
              </div>
              <div className="rec-doc-viewer__actions">
                {url ? (
                  <a className="rec-btn rec-btn--secondary" href={url} download={doc?.fileName}>
                    <span>Download</span>
                  </a>
                ) : null}
                {url ? (
                  <a className="rec-link body-sm" href={url} target="_blank" rel="noopener noreferrer">
                    Open in new tab
                  </a>
                ) : null}
                <DialogPrimitive.Close
                  ref={closeRef}
                  className="rec-btn rec-btn--primary"
                  aria-label="Close"
                  data-testid="document-viewer-close"
                >
                  <span>Close</span>
                </DialogPrimitive.Close>
              </div>
            </header>
            <div className="rec-doc-viewer__body">
              {!doc || !url ? (
                <p className="body">The file could not be opened.</p>
              ) : (
                <DocumentFrame
                  url={url}
                  fileName={doc.fileName}
                  mime={doc.mime}
                  kind={kind}
                  pdfFailed={pdfFailed}
                  onPdfFailed={() => setPdfFailed(true)}
                />
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DocumentFrame({
  url,
  fileName,
  mime,
  kind,
  pdfFailed = false,
  onPdfFailed,
  className,
}: {
  url: string;
  fileName: string;
  mime: string;
  kind: ViewerKind;
  pdfFailed?: boolean;
  onPdfFailed?: () => void;
  className?: string;
}) {
  if (kind === "pdf" && !pdfFailed) {
    return (
      <div className={cn("rec-doc-plate", className)}>
        <object data={url} type="application/pdf" className="rec-doc-frame" aria-label={fileName}>
          <iframe title={fileName} src={url} className="rec-doc-frame" onError={() => onPdfFailed?.()} />
        </object>
      </div>
    );
  }

  if (kind === "image") {
    return (
      <div className={cn("rec-doc-plate rec-doc-plate--image", className)}>
        {/* Signed or blob URLs are already authorized; next/image is not used for private storage. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={fileName} className="rec-doc-image" />
      </div>
    );
  }

  return (
    <div className={cn("rec-doc-fallback", className)}>
      <p className="body">
        {kind === "pdf" || pdfFailed
          ? "This browser cannot show this PDF here."
          : `${fileName} cannot be previewed in the app.`}
      </p>
      <p className="caption rec-muted">{mime || "Unknown type"}</p>
      <a className="rec-btn rec-btn--primary" href={url} download={fileName}>
        <span>Download</span>
      </a>
    </div>
  );
}
