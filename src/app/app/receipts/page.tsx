import { notFound } from "next/navigation";
import { FeeQueue } from "@/components/protocols/fee-queue";
import { isCommitteeStaff } from "@/server/authz/staff";
import { listPendingReceipts } from "@/server/protocols/fees";
import { billFiles, listOpenBills } from "@/server/fees/bills";
import { BillDecision } from "@/components/protocols/bill-decision";
import { BILL_LABEL } from "@/components/protocols/fees-section";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCentavos } from "@/lib/forms/money";
import { outstanding } from "@/lib/fees/calc";
import Link from "next/link";
import { requireUser } from "@/server/session";

export const metadata = { title: "Fee receipts" };

export default async function ReceiptsPage() {
  const user = await requireUser();
  if (!(await isCommitteeStaff(user.id))) notFound();
  const fees = await listPendingReceipts();
  const bills = await listOpenBills();
  const proofs = await billFiles(bills.map((bill) => bill.id));
  return (
    <article className="rec-stack">
      <h1 className="title">Fee receipts</h1>
      <p className="body rec-muted">Receipts waiting for REC Staff to verify or reject.</p>
      <h2 className="heading">Bills</h2>
      <p className="body-sm rec-muted">Bills not yet settled, including those released with an amount outstanding.</p>
      {bills.length === 0 ? <p className="body">No bill is open.</p> : null}
      <ul className="rec-methods">
        {bills.map((bill) => {
          const state = BILL_LABEL[bill.status] ?? { tone: "info" as const, label: bill.status };
          return (
            <li key={bill.id} className="rec-card rec-stack">
              <p className="code">{bill.protocol.code ?? "Code not assigned"}</p>
              <p className="body">
                <Link href={`/app/protocols/${bill.protocol.id}`}>{bill.protocol.title}</Link>
              </p>
              <p className="body-sm">
                {bill.description} · {formatCentavos(bill.amount)} · {formatCentavos(outstanding(bill))} outstanding ·{" "}
                <StatusBadge tone={state.tone} label={state.label} />
              </p>
              {proofs
                .filter((file) => file.billId === bill.id)
                .map((file) => (
                  <OpenStoredFileButton key={file.id} fileId={file.id} protocolId={bill.protocol.id} label={`Open ${file.originalName}`} />
                ))}
              <BillDecision protocolId={bill.protocol.id} billId={bill.id} />
            </li>
          );
        })}
      </ul>
      <h2 className="heading">Receipts</h2>
      <FeeQueue
        rows={fees.map((fee) => ({
          id: fee.id,
          protocolId: fee.protocolVersion.protocolId,
          title: fee.protocolVersion.protocol.title,
          code: fee.protocolVersion.protocol.code,
          label: fee.protocolVersion.label,
          fileName: fee.protocolVersion.files[0]?.originalName ?? null,
          fileId: fee.protocolVersion.files[0]?.id ?? null,
        }))}
      />
    </article>
  );
}
