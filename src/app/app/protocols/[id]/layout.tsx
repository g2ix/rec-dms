import { notFound } from "next/navigation";
import { DownloadMenu } from "@/components/protocols/download-menu";
import { PreviewFormsButton } from "@/components/protocols/intake/preview-button";
import { ProtocolHeader } from "@/components/protocols/protocol-header";
import { ProtocolNav } from "@/components/protocols/protocol-nav";
import { ChecklistProvider } from "@/components/protocols/submission-checklist";
import { ProtocolCrumb } from "@/components/shell/crumbs";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { usesIntake } from "@/server/intake/state";
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
    // The forms preview lives on the Intake tab, so the header offers it only on intake versions.
    const intake = proponentView && header.shown ? await usesIntake(prisma, header.shown.id) : false;
    const page = (
      <article className="rec-stack rec-proto-page">
        <ProtocolCrumb id={id} label={header.protocol.code ?? header.protocol.title} />
        <ProtocolHeader
          code={header.protocol.code}
          title={header.protocol.title}
          version={header.shown?.label ?? null}
          versionNumber={header.shown?.number ?? null}
          status={header.protocol.status}
          leaderName={header.protocol.leader.displayName}
          createdAt={header.protocol.createdAt}
          actions={
            header.shown ? (
              <>
                {intake ? <PreviewFormsButton protocolId={id} /> : null}
                <DownloadMenu protocolId={id} versionId={header.shown.id} />
              </>
            ) : null
          }
        />
        <ProtocolNav protocolId={id} />
        {children}
      </article>
    );
    if (!proponentView || !checklist) return page;
    // The checklist feeds the tab counts and the Intake steps; its full panel is on the Overview tab.
    return (
      <ChecklistProvider protocolId={id} initial={checklist}>
        {page}
      </ChecklistProvider>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}
