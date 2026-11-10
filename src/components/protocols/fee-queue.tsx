"use client";

import { useActionState } from "react";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { rejectFeeAction, verifyFeeAction } from "@/server/protocols/actions";
import type { ActionState } from "@/server/action-state";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function FeeQueue({
  rows,
}: {
  rows: {
    id: string;
    protocolId: string;
    title: string;
    code: string | null;
    label: string;
    fileName: string | null;
    fileId: string | null;
  }[];
}) {
  if (rows.length === 0) return <p className="body">No fee receipts are waiting.</p>;
  return (
    <ul className="rec-methods">
      {rows.map((row) => (
        <FeeRow key={row.id} row={row} />
      ))}
    </ul>
  );
}

function FeeRow({
  row,
}: {
  row: {
    id: string;
    protocolId: string;
    title: string;
    code: string | null;
    label: string;
    fileName: string | null;
    fileId: string | null;
  };
}) {
  const [state, action, pending] = useActionState(rejectFeeAction, null);
  return (
    <li className="rec-card rec-stack">
      <p className="code">{row.code ?? "Code not assigned"}</p>
      <h2 className="heading">{row.title}</h2>
      <p className="body-sm">
        Version <span className="code">{row.label}</span>
        {row.fileName ? ` · ${row.fileName}` : ""}
      </p>
      {row.fileId ? <OpenStoredFileButton fileId={row.fileId} protocolId={row.protocolId} label="Open receipt" /> : null}
      <div className="rec-inline">
        <form action={verifyFeeAction}>
          <input type="hidden" name="feeId" value={row.id} />
          <input type="hidden" name="protocolId" value={row.protocolId} />
          <BusyButton type="submit" variant="primary">
            Verify receipt
          </BusyButton>
        </form>
      </div>
      <form action={action} className="rec-form">
        {(state as ActionState)?.error ? (
          <p className="rec-alert" role="alert">
            {(state as ActionState)?.error}
          </p>
        ) : null}
        <input type="hidden" name="feeId" value={row.id} />
        <input type="hidden" name="protocolId" value={row.protocolId} />
        <Field label="Reason for rejection" htmlFor={`reason-${row.id}`}>
          <Input id={`reason-${row.id}`} name="reason" required />
        </Field>
        <BusyButton type="submit" variant="danger" busy={pending} busyLabel="Rejecting…">
          Reject receipt
        </BusyButton>
      </form>
    </li>
  );
}
