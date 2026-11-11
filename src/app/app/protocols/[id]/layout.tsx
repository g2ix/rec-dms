import { notFound } from "next/navigation";
import { DownloadMenu } from "@/components/protocols/download-menu";
import { ProtocolHeader } from "@/components/protocols/protocol-header";
import { ProtocolNav } from "@/components/protocols/protocol-nav";
import { ProtocolCrumb } from "@/components/shell/crumbs";
import { AppError } from "@/server/errors";
import { tabCounts } from "@/lib/protocols/checklist";
import { getSubmissionChecklist } from "@/server/protocols/checklist";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  try {
    const [header, checklist] = await Promise.all([protocolHeader(user.id, id), getSubmissionChecklist(user.id, id)]);
    return (
      <article className="rec-stack">
        <ProtocolCrumb id={id} label={header.protocol.code ?? header.protocol.title} />
        <ProtocolHeader
          code={header.protocol.code}
          title={header.protocol.title}
          version={header.shown?.label ?? null}
          versionNumber={header.shown?.number ?? null}
          status={header.protocol.status}
          leaderName={header.protocol.leader.displayName}
          createdAt={header.protocol.createdAt}
          actions={header.shown ? <DownloadMenu protocolId={id} versionId={header.shown.id} /> : null}
        />
        <ProtocolNav
          protocolId={id}
          counts={!header.staff && (header.mine?.role === "PROPONENT" || header.mine?.role === "ADVISER") ? tabCounts(checklist) : undefined}
        />
        {children}
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}
