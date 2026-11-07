import { notFound } from "next/navigation";
import { PdfDownload } from "@/components/docs/pdf-download";
import { ProtocolHeader } from "@/components/protocols/protocol-header";
import { ProtocolNav } from "@/components/protocols/protocol-nav";
import { AppError } from "@/server/errors";
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
    const header = await protocolHeader(user.id, id);
    return (
      <article className="rec-stack">
        <ProtocolHeader
          code={header.protocol.code}
          title={header.protocol.title}
          version={header.shown?.label ?? null}
          status={header.protocol.status}
        />
        <ProtocolNav protocolId={id} />
        {header.shown ? (
          <div className="rec-actions">
            <PdfDownload
              href={`/api/protocols/${id}/package?format=pdf&version=${header.shown.id}`}
              label="Download submission package"
            />
            <PdfDownload
              href={`/api/protocols/${id}/package?format=zip&version=${header.shown.id}`}
              label="Download ZIP"
              ready="Package ready"
            />
          </div>
        ) : null}
        {children}
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")) notFound();
    throw error;
  }
}
