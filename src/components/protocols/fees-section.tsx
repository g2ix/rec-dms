import { OpenStoredFileButton } from "@/components/docs/document-open";
import { BillDecision } from "@/components/protocols/bill-decision";
import { BillProofUpload } from "@/components/protocols/bill-proof";
import { BusyButton } from "@/components/ui/busy-button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { outstanding } from "@/lib/fees/calc";
import { formatCentavos } from "@/lib/forms/money";
import { formatManila } from "@/lib/time";
import { isCommitteeStaff } from "@/server/authz/staff";
import { prisma } from "@/server/db";
import { setClientTypeAction } from "@/server/fees/actions";
import { billFiles, protocolBills } from "@/server/fees/bills";
import { suggestClientType } from "@/server/fees/client-type";

export const BILL_LABEL: Record<string, { tone: StatusTone; label: string }> = {
  ISSUED: { tone: "warning", label: "Waiting for payment" },
  PAID_PENDING: { tone: "info", label: "Payment to check" },
  PARTIALLY_PAID: { tone: "warning", label: "Partly paid" },
  VERIFIED: { tone: "success", label: "Paid" },
  REJECTED: { tone: "danger", label: "Payment rejected" },
  WAIVED: { tone: "success", label: "Waived" },
};

/** Bills on the protocol page. Proponents upload proof of payment; REC Staff set the client type and check payments. */
export async function FeesSection({ protocolId, userId }: { protocolId: string; userId: string }) {
  const [staff, protocol, bills, types] = await Promise.all([
    isCommitteeStaff(userId),
    prisma.protocol.findUnique({ where: { id: protocolId }, select: { clientTypeKey: true } }),
    protocolBills(protocolId),
    prisma.clientType.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
  ]);
  const member = await prisma.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE", role: { in: ["PROPONENT", "ADVISER"] } } });
  if (!staff && bills.length === 0) return null;
  if (!staff && !member) return null;
  const files = await billFiles(bills.map((bill) => bill.id));
  const suggestion = staff && !protocol?.clientTypeKey ? await suggestClientType(protocolId) : null;
  return (
    <section className="rec-card rec-stack">
      <h2 className="heading">Fees</h2>
      {staff && types.length > 0 ? (
        <form action={setClientTypeAction} className="rec-actions">
          <input type="hidden" name="protocolId" value={protocolId} />
          <label className="rec-field">
            <span className="label">Client type</span>
            <select className="rec-select" name="clientTypeKey" defaultValue={protocol?.clientTypeKey ?? suggestion ?? ""}>
              <option value="">Not set</option>
              {types.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
            <span className="rec-field__help">
              {suggestion
                ? "Suggested from the project leader’s profile and source of funds. Save to use it."
                : "Filled in from the project leader’s profile and source of funds when the protocol is submitted. Change it here if it is wrong; a bill already issued keeps its amount."}
            </span>
          </label>
          <BusyButton type="submit">Save client type</BusyButton>
        </form>
      ) : null}
      {bills.length === 0 ? <p className="body-sm rec-muted">No bill has been issued.</p> : null}
      <ul className="rec-methods">
        {bills.map((bill) => {
          const state = BILL_LABEL[bill.status] ?? { tone: "info" as const, label: bill.status };
          const proofs = files.filter((file) => file.billId === bill.id);
          const open = bill.status !== "VERIFIED" && bill.status !== "WAIVED";
          return (
            <li key={bill.id} className="rec-stack">
              <p className="body">{bill.description}</p>
              <p className="body-sm">
                {formatCentavos(bill.amount)} · issued {formatManila(bill.issuedAt, "d MMM yyyy")} · <StatusBadge tone={state.tone} label={state.label} />
                {bill.status === "PARTIALLY_PAID" ? ` · ${formatCentavos(outstanding(bill))} outstanding` : ""}
              </p>
              {bill.reason ? <p className="body-sm">{bill.reason}</p> : null}
              {bill.statementFileId ? <OpenStoredFileButton fileId={bill.statementFileId} protocolId={protocolId} label="Open statement of account" /> : null}
              {proofs.map((file) => (
                <OpenStoredFileButton key={file.id} fileId={file.id} protocolId={protocolId} label={`Open ${file.originalName}`} />
              ))}
              {open && member ? <BillProofUpload protocolId={protocolId} billId={bill.id} /> : null}
              {open && staff && !member ? <BillDecision protocolId={protocolId} billId={bill.id} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
