import { notFound } from "next/navigation";
import { FeeQueue } from "@/components/protocols/fee-queue";
import { isCommitteeStaff } from "@/server/authz/staff";
import { listPendingReceipts } from "@/server/protocols/fees";
import { requireUser } from "@/server/session";

export const metadata = { title: "Fee receipts" };

export default async function ReceiptsPage() {
  const user = await requireUser();
  if (!(await isCommitteeStaff(user.id))) notFound();
  const fees = await listPendingReceipts();
  return (
    <article className="rec-stack">
      <h1 className="title">Fee receipts</h1>
      <p className="body rec-muted">Receipts waiting for REC Staff to verify or reject.</p>
      <FeeQueue
        rows={fees.map((fee) => ({
          id: fee.id,
          protocolId: fee.protocolVersion.protocolId,
          title: fee.protocolVersion.protocol.title,
          code: fee.protocolVersion.protocol.code,
          label: fee.protocolVersion.label,
          fileName: fee.protocolVersion.files[0]?.originalName ?? null,
        }))}
      />
    </article>
  );
}
