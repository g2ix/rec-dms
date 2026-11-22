"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, ImageUp, Upload } from "lucide-react";
import { Icon } from "@/components/icons";
import { BusyButton } from "@/components/ui/busy-button";
import { formatSignatureTime } from "@/lib/time";
import { saveSignatureAction } from "@/server/signatures/actions";

/** Ink stays dark in both themes: the plate is always white and the server strips the white away. */
const INK = "#111827";
const ACCEPTED = ["image/png", "image/jpeg"];
const MAX_BYTES = 4 * 1024 * 1024;

type Pad = { clear: () => void; isEmpty: () => boolean; off: () => void };

export function SignatureStudio({
  current,
}: {
  current: { dataUrl: string | null; version: number; method: "DRAWN" | "UPLOADED"; createdAt: string; older: number } | null;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<Pad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"DRAWN" | "UPLOADED" | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = canvas.clientWidth || 600;
    const height = 200;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext("2d");
    context?.scale(ratio, ratio);
    void import("signature_pad").then(({ default: SignaturePad }) => {
      if (stopped) return;
      padRef.current = new SignaturePad(canvas, { backgroundColor: "rgb(255, 255, 255)", penColor: INK });
    });
    return () => {
      stopped = true;
      padRef.current?.off();
      padRef.current = null;
    };
  }, []);

  function save(file: Blob, method: "DRAWN" | "UPLOADED", name: string, after?: () => void) {
    setError(null);
    setSaving(method);
    startTransition(async () => {
      const form = new FormData();
      form.set("file", new File([file], name, { type: file.type || "image/png" }));
      form.set("method", method);
      try {
        const result = await saveSignatureAction(null, form);
        if (result?.error) {
          setError(result.error);
          return;
        }
        after?.();
        router.refresh();
      } catch {
        setError("The signature could not be saved. Check your connection and try again.");
      } finally {
        setSaving(null);
      }
    });
  }

  function saveDrawn() {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas || pad.isEmpty()) {
      setError("Draw your signature in the box first.");
      return;
    }
    // toBlob reads the canvas directly. Fetching its data: URL is blocked by the connect-src policy.
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("The drawing could not be read. Clear the box and try again.");
        return;
      }
      save(blob, "DRAWN", "signature.png", () => pad.clear());
    }, "image/png");
  }

  return (
    <div className="rec-stack">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      {current ? (
        <section className="rec-card rec-stack" aria-label="Current signature">
          <h2 className="heading">Current signature</h2>
          {current.dataUrl ? (
            <div className="rec-sign__plate rec-sign__plate--current">
              {/* Data URL of a private signature. next/image does not load these. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.dataUrl} alt="Your signature" />
            </div>
          ) : (
            <p className="body-sm rec-muted">The image could not be loaded.</p>
          )}
          <p className="caption rec-muted">
            Version {current.version}, {current.method === "DRAWN" ? "drawn" : "uploaded"} {formatSignatureTime(new Date(current.createdAt))}.
            {current.older > 0 ? ` ${current.older} earlier version${current.older === 1 ? "" : "s"} stay on forms already signed.` : ""}
          </p>
        </section>
      ) : (
        <p className="rec-banner body-sm" role="status">
          You have not saved a signature yet. You need one before you can sign F-27, F-28 and other forms.
        </p>
      )}

      <div className="rec-sign-studio">
        <section className="rec-card rec-stack" aria-labelledby="draw-signature">
          <div>
            <h2 id="draw-signature" className="heading">Draw</h2>
            <p className="body-sm rec-muted">Sign inside the white box with your mouse, pen or finger.</p>
          </div>
          <div className="rec-sign__plate">
            <canvas ref={canvasRef} className="rec-sign__canvas" aria-label="Signature pad" />
          </div>
          <div className="rec-actions">
            <BusyButton type="button" variant="ghost" disabled={saving !== null} onClick={() => padRef.current?.clear()}>
              Clear
            </BusyButton>
            <BusyButton type="button" variant="primary" busy={saving === "DRAWN"} disabled={saving === "UPLOADED"} busyLabel="Saving…" onClick={saveDrawn}>
              Save drawing
            </BusyButton>
          </div>
        </section>

        <section className="rec-card rec-stack" aria-labelledby="upload-signature">
          <div>
            <h2 id="upload-signature" className="heading">Upload</h2>
            <p className="body-sm rec-muted">A photo or scan of your signature on white paper. The white background is removed.</p>
          </div>
          <SignatureUpload
            busy={saving === "UPLOADED"}
            disabled={saving === "DRAWN"}
            onSave={(file, after) => save(file, "UPLOADED", file.name, after)}
          />
        </section>
      </div>
    </div>
  );
}

/** Drop or click to choose a PNG or JPG, preview it, then save. */
function SignatureUpload({ busy, disabled, onSave }: { busy: boolean; disabled: boolean; onSave: (file: File, after: () => void) => void }) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(list: FileList | null) {
    const chosen = list?.[0];
    if (!chosen) return;
    if (!ACCEPTED.includes(chosen.type)) {
      setProblem(`${chosen.name} is not a PNG or JPG.`);
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setProblem(`${chosen.name} is larger than 4 MB.`);
      return;
    }
    setProblem(null);
    setFile(chosen);
  }

  const zoneClass = ["rec-dropzone", dragging ? "rec-dropzone--over" : "", problem ? "rec-dropzone--error" : file ? "rec-dropzone--done" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="rec-stack">
      <div
        className={zoneClass}
        data-testid="signature-dropzone"
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (!busy && !disabled) choose(event.dataTransfer.files);
        }}
      >
        <input
          id="signature-file"
          type="file"
          className="sr-only"
          accept={ACCEPTED.join(",")}
          disabled={busy || disabled}
          onChange={(event) => {
            const target = event.currentTarget;
            choose(target.files);
            target.value = "";
          }}
        />
        <label htmlFor="signature-file" className="rec-dropzone__body">
          <span className="rec-dropzone__icon" aria-hidden="true">
            <Icon icon={problem ? CircleAlert : file ? ImageUp : Upload} size={18} />
          </span>
          <span className="rec-dropzone__text">
            <span className="label">Signature image</span>
            <span className="caption rec-muted" aria-live="polite">
              {problem ?? (file ? file.name : dragging ? "Drop to choose" : "Drop a PNG or JPG here, or click to choose · up to 4 MB")}
            </span>
          </span>
          {file ? <span className="caption rec-dropzone__action">Change</span> : null}
        </label>
      </div>
      {preview ? (
        <div className="rec-sign__plate">
          {/* Local object URL of the chosen file. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Chosen signature image" />
        </div>
      ) : null}
      <div className="rec-actions">
        {file ? (
          <BusyButton type="button" variant="ghost" disabled={busy} onClick={() => setFile(null)}>
            Remove
          </BusyButton>
        ) : null}
        <BusyButton
          type="button"
          variant="primary"
          busy={busy}
          busyLabel="Saving…"
          disabled={!file || disabled}
          onClick={() => file && onSave(file, () => setFile(null))}
        >
          Save upload
        </BusyButton>
      </div>
    </div>
  );
}
