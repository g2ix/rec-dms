import { UploadsPanel } from "@/components/protocols/uploads-panel";
import { listUploads } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolUploadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await listUploads(user.id, id);
  const canUpload = data.header.mine?.status === "ACTIVE" && data.header.mine.role === "PROPONENT";
  return (
    <UploadsPanel
      protocolId={id}
      suggestedManuscript={data.suggestedManuscript}
      locked={!data.header.working || !canUpload}
      feeStatus={data.fee?.status ?? null}
      files={data.files.map((file) => ({
        id: file.id,
        kind: file.kind,
        originalName: file.originalName,
        suggestedName: file.suggestedName,
        scanStatus: file.scanStatus,
        size: file.size,
      }))}
    />
  );
}
