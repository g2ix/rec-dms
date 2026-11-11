"use client";

import { ChevronDown, Download } from "lucide-react";
import { Icon } from "@/components/icons";
import { useFileDownload } from "@/components/docs/pdf-download";
import { ProgressRow } from "@/components/ui/progress-row";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** One "Download" button for the submission package PDF and the ZIP of all files. */
export function DownloadMenu({ protocolId, versionId }: { protocolId: string; versionId: string }) {
  const { pending, message, run } = useFileDownload();
  const base = `/api/protocols/${protocolId}/package?version=${versionId}`;
  return (
    <div className="rec-download">
      <DropdownMenu>
        <DropdownMenuTrigger className="rec-btn rec-btn--secondary" disabled={pending} aria-busy={pending || undefined}>
          <Icon icon={Download} size={16} />
          <span>{pending ? "Preparing…" : "Download"}</span>
          <Icon icon={ChevronDown} size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void run(`${base}&format=pdf`, "PDF ready")}>Submission package (PDF)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run(`${base}&format=zip`, "Package ready")}>All files (ZIP)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pending ? <ProgressRow label="Preparing the file…" /> : null}
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
