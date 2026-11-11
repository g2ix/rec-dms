"use client";

import { useActionState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { decideBillAction } from "@/server/fees/actions";

/** REC Staff verify a payment, record part of it, or reject it with a reason. */
export function BillDecision({ protocolId, billId }: { protocolId: string; billId: string }) {
  const [state, action, pending] = useActionState(decideBillAction, null);
  return (
    <form action={action} className="rec-form">
      {state?.error ? (
        <p className="rec-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      <input type="hidden" name="protocolId" value={protocolId} />
      <input type="hidden" name="billId" value={billId} />
      <fieldset className="rec-stack">
        <legend className="label">Payment</legend>
        <label className="rec-choice">
          <input type="radio" name="decision" value="VERIFIED" defaultChecked />
          <span>Paid in full</span>
        </label>
        <label className="rec-choice">
          <input type="radio" name="decision" value="PARTIAL" />
          <span>Part paid</span>
        </label>
        <label className="rec-choice">
          <input type="radio" name="decision" value="REJECTED" />
          <span>Reject the proof</span>
        </label>
      </fieldset>
      <label className="rec-field">
        <span className="label">Amount paid (part payment)</span>
        <input className="rec-input" name="amountPaid" inputMode="decimal" />
      </label>
      <label className="rec-field rec-field--wide">
        <span className="label">Reason (required to reject)</span>
        <input className="rec-input" name="reason" />
      </label>
      <BusyButton type="submit" busy={pending} busyLabel="Saving…">
        Record
      </BusyButton>
    </form>
  );
}
