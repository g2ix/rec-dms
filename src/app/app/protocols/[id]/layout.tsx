import { notFound } from "next/navigation";
import { DownloadMenu } from "@/components/protocols/download-menu";
import { ProtocolHeader } from "@/components/protocols/protocol-header";
import { ProtocolNav } from "@/components/protocols/protocol-nav";
import { ChecklistProvider, SubmissionChecklistPanel } from "@/components/protocols/submission-checklist";
import { ProtocolCrumb } from "@/components/shell/crumbs";
import { AppError } from "@/server/errors";
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
    const proponentView = !header.staff && (header.mine?.role === "PROPONENT" || header.mine?.role === "ADVISER");
    const top = (
      <>
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
      </>
    );
    if (!proponentView || !checklist) {
      return (
        <article className="rec-stack">
          {top}
          <ProtocolNav protocolId={id} />
          {children}
        </article>
      );
    }
    // While the proponents' step is open, the checklist sits beside every tab so they can track it anywhere.
    return (
      <ChecklistProvider protocolId={id} initial={checklist}>
        <article className="rec-stack">
          {top}
          <ProtocolNav protocolId={id} />
          <div className="rec-proto">
            <div className="rec-overview">
              <div className="rec-overview__main">{children}</div>
              <div className="rec-overview__side">
                <SubmissionChecklistPanel />
              </div>
            </div>
          </div>
        </article>
      </ChecklistProvider>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}
