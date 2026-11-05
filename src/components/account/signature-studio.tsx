"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { formatSignatureTime } from "@/lib/time";
import { saveSignatureAction } from "@/server/signatures/actions";

export function SignatureStudio({
  current,
}: {
  current: { dataUrl: string | null; version: number; method: "DRAWN" | "UPLOADED"; createdAt: string; older: number } | null;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<{ clear: () => void; isEmpty: () => boolean; toDataURL: (type?: string) => string; off: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      const root = getComputedStyle(document.documentElement);
      const pad = new SignaturePad(canvas, {
        backgroundColor: root.getPropertyValue("--plate").trim() || "rgb(255, 255, 255)",
        penColor: getComputedStyle(canvas).color,
      });
      padRef.current = pad;
    });
    return () => {
      stopped = true;
      padRef.current?.off();
      padRef.current = null;
    };
  }, []);

  function saveDrawn() {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      setError("Draw your signature in the box first.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const blob = await (await fetch(pad.toDataURL("image/png"))).blob();
      const form = new FormData();
      form.set("file", new File([blob], "signature.png", { type: "image/png" }));
      form.set("method", "DRAWN");
      const result = await saveSignatureAction(null, form);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function saveUpload(formData: FormData) {
    setError(null);
    formData.set("method", "UPLOADED");
    startTransition(async () => {
      const result = await saveSignatureAction(null, formData);
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rec-stack">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      {current ? (
        <section className="rec-stack" aria-label="Current signature">
          <h2 className="heading">Current signature</h2>
          {current.dataUrl ? (
            <div className="rec-sign__plate">
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
        <p className="body">You have not saved a signature yet.</p>
      )}

      <section className="rec-stack" aria-labelledby="draw-signature">
        <h2 id="draw-signature" className="heading">Draw</h2>
        <p className="body-sm rec-muted">Draw on the white box. Saving removes the white background and keeps the ink.</p>
        <div className="rec-sign__plate">
          <canvas ref={canvasRef} className="rec-sign__canvas" aria-label="Signature pad" />
        </div>
        <div className="rec-actions">
          <BusyButton type="button" variant="ghost" onClick={() => padRef.current?.clear()}>
            Clear
          </BusyButton>
          <BusyButton type="button" variant="primary" busy={pending} busyLabel="Saving…" onClick={saveDrawn}>
            Save drawing
          </BusyButton>
        </div>
      </section>

      <section className="rec-stack" aria-labelledby="upload-signature">
        <h2 id="upload-signature" className="heading">Upload</h2>
        <form action={saveUpload} className="rec-form">
          <label className="label" htmlFor="signature-file">
            PNG or JPG
          </label>
          <input id="signature-file" className="rec-input" name="file" type="file" accept="image/png,image/jpeg" required />
          <BusyButton type="submit" busy={pending} busyLabel="Saving…">
            Save upload
          </BusyButton>
        </form>
      </section>
    </div>
  );
}
