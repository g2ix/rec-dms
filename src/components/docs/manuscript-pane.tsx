"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DocumentFrame, DocumentViewer, type DocumentViewerDoc } from "@/components/docs/document-viewer";
import { Button } from "@/components/ui/button";
import { SIGNED_URL_REFRESH_MS, viewerKindFor } from "@/lib/docs/viewer";
import { downloadFileAction } from "@/server/protocols/actions";

export type ManuscriptRef = {
  fileId: string;
  protocolId: string;
  fileName: string;
  mime: string;
  protocolCode: string | null;
};

/** Side pane for review screens: shows the manuscript beside the form on wide screens. */
export function ManuscriptPane({ manuscript }: { manuscript: ManuscriptRef }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [doc, setDoc] = useState<DocumentViewerDoc | null>(null);
  const [viewer, setViewer] = useState<DocumentViewerDoc | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await downloadFileAction({
      fileId: manuscript.fileId,
      protocolId: manuscript.protocolId,
    });
    if (!result.ok) {
      setMessage(result.message);
      return null;
    }
    if (result.warning) setMessage(result.warning);
    return {
      url: result.url,
      fileName: result.fileName,
      mime: result.mime,
      protocolCode: result.protocolCode,
    } satisfies DocumentViewerDoc;
  }, [manuscript.fileId, manuscript.protocolId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const next = await load();
      if (cancelled) return;
      setDoc(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const next = await load();
    if (next) {
      setDoc(next);
      setViewer((current) => (current ? next : current));
      return next.url;
    }
    return null;
  }, [load]);

  useEffect(() => {
    if (!doc) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, SIGNED_URL_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [doc, refresh]);

  const kind = viewerKindFor(manuscript.mime, manuscript.fileName);

  return (
    <aside className="rec-review-split__doc" aria-label="Manuscript">
      <div className="rec-review-split__doc-bar">
        <div>
          <p className="label">Manuscript</p>
          <p className="caption rec-muted">{manuscript.fileName}</p>
        </div>
        <Button
          ref={triggerRef}
          type="button"
          variant="secondary"
          onClick={() => {
            if (doc) setViewer(doc);
          }}
          disabled={!doc}
        >
          Open full screen
        </Button>
      </div>
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      {loading ? <p className="body-sm rec-muted">Opening the manuscript…</p> : null}
      {!loading && doc ? (
        <DocumentFrame url={doc.url} fileName={doc.fileName} mime={doc.mime} kind={kind} className="rec-review-split__frame" />
      ) : null}
      {!loading && !doc && !message ? <p className="body-sm">The manuscript could not be opened.</p> : null}
      <DocumentViewer
        open={viewer != null}
        doc={viewer}
        onClose={() => setViewer(null)}
        onRefreshUrl={refresh}
        returnFocusRef={triggerRef}
      />
    </aside>
  );
}

/** Compact control for phones: opens the manuscript in the full viewer. */
export function ManuscriptOpenButton({ manuscript }: { manuscript: ManuscriptRef }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<DocumentViewerDoc | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await downloadFileAction({
      fileId: manuscript.fileId,
      protocolId: manuscript.protocolId,
    });
    if (!result.ok) {
      setMessage(result.message);
      return null;
    }
    if (result.warning) setMessage(result.warning);
    return {
      url: result.url,
      fileName: result.fileName,
      mime: result.mime,
      protocolCode: result.protocolCode,
    } satisfies DocumentViewerDoc;
  }, [manuscript.fileId, manuscript.protocolId]);

  async function open() {
    setBusy(true);
    setMessage(null);
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
    <div className="rec-stack rec-review-split__mobile">
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      <Button ref={triggerRef} type="button" variant="secondary" onClick={() => void open()} disabled={busy} aria-busy={busy}>
        {busy ? "Opening…" : "Open manuscript"}
      </Button>
      <DocumentViewer
        open={doc != null}
        doc={doc}
        onClose={() => setDoc(null)}
        onRefreshUrl={refresh}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}
