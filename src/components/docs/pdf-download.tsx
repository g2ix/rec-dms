"use client";

import { useState } from "react";
import { toast } from "@/components/ui/toast";
import { ProgressRow } from "@/components/ui/progress-row";

export function PdfDownload({
  href,
  label,
  inline = false,
  ready = "PDF ready",
}: {
  href: string;
  label: string;
  inline?: boolean;
  ready?: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    const probeUrl = `${href}${href.includes("?") ? "&" : "?"}probe=1`;
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const probe = await fetch(probeUrl);
        if (probe.status === 202) {
          await wait(3_000);
          continue;
        }
        if (!probe.ok) {
          setMessage("The PDF could not be prepared.");
          return;
        }
        const file = await fetch(href);
        if (!file.ok) {
          setMessage("The PDF could not be downloaded.");
          return;
        }
        const blob = await file.blob();
        const url = URL.createObjectURL(blob);
        if (inline) {
          window.open(url, "_blank", "noopener");
        } else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = fileName(file) ?? "document.pdf";
          anchor.click();
        }
        toast(ready);
        return;
      }
      setMessage("The PDF is still being prepared. Try again in a minute.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rec-stack">
      <button
        type="button"
        className="rec-btn rec-btn--secondary"
        onClick={() => void run()}
        disabled={pending}
        aria-busy={pending}
      >
        <span>{pending ? "Preparing…" : label}</span>
      </button>
      {pending ? <ProgressRow label="Preparing the PDF…" /> : null}
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function fileName(response: Response): string | null {
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
