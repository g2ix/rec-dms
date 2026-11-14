"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StepUpConfirm, type StepUpCredentials } from "@/components/forms/signature-field";
import { useActionResult } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { flushRegisteredAutosaves } from "@/lib/forms/flush-registry";
import type { IntakeSigningView, SigningRow } from "@/lib/intake/signing-view";
import { signIntakeFormsAction, withdrawIntakeSigningAction } from "@/server/intake/actions";

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One row per researcher. A researcher agrees above, then signs F-27 and F-28 with one act from
 * their own row. Other rows show only whether that researcher has signed.
 */
export function IntakeSigningSection({ protocolId, signing }: { protocolId: string; signing: IntakeSigningView }) {
  const codes = signing.forms.map((form) => form.code);
  return (
    <div className="rec-stack" data-testid="signing">
      <h3 className="subheading">Sign {andList(codes)}</h3>
      <p className="body-sm rec-muted">
        {codes.length > 1 ? "One signature covers both forms." : `Your signature goes on ${codes[0] ?? "the form"}.`} Every researcher signs on their own account.
      </p>
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">Researcher</th>
              <th scope="col">Agreed</th>
              <th scope="col">Signed</th>
            </tr>
          </thead>
          <tbody>
            {signing.rows.map((row) => (
              <tr key={row.memberId} data-testid={row.mine ? "signing-mine" : "signing-other"}>
                <th scope="row">
                  {row.name}
                  {row.mine ? <span className="rec-muted"> (you)</span> : null}
                </th>
                <td>{row.agreed ? "Agreed" : "Not yet"}</td>
                <td>{row.mine ? <MyRow protocolId={protocolId} row={row} signing={signing} /> : row.state === "signed" ? "Signed" : "Not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyRow({ protocolId, row, signing }: { protocolId: string; row: SigningRow; signing: IntakeSigningView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function withdraw() {
    setError(null);
    startTransition(async () => {
      const result = await withdrawIntakeSigningAction({ protocolId });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  if (row.state === "signed") {
    return (
      <div className="rec-stack">
        <p className="body-sm">{row.signedOnLabel ? `Signed on ${row.signedOnLabel}` : "Signed"}</p>
        {row.imageDataUrl ? (
          <div className="rec-sign__plate">
            {/* The plate stays white in dark mode so the ink stays readable. Data URL of a private signature. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.imageDataUrl} alt={`Signature of ${row.name}`} />
          </div>
        ) : null}
        {signing.editable ? (
          <>
            <div className="rec-actions">
              <BusyButton type="button" variant="secondary" busy={pending} busyLabel="Withdrawing…" onClick={withdraw}>
                Withdraw
              </BusyButton>
            </div>
            <p className="caption rec-muted">Withdrawing takes back your agreements and voids both signatures.</p>
          </>
        ) : null}
        {error ? (
          <p className="rec-alert" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rec-stack">
      {row.state === "again" ? (
        <p role="status">
          <StatusBadge tone="danger" label={`Signature void on ${andList(row.toSign)}`} />
        </p>
      ) : (
        <p className="body-sm rec-muted">Not yet</p>
      )}
      {signing.editable ? <SignDialog protocolId={protocolId} row={row} signing={signing} /> : null}
    </div>
  );
}

function SignDialog({ protocolId, row, signing }: { protocolId: string; row: SigningRow; signing: IntakeSigningView }) {
  const router = useRouter();
  const showResult = useActionResult();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = row.state === "again" ? "Sign again" : `Sign ${andList(signing.forms.map((form) => form.code))}`;
  const titles = signing.forms.filter((form) => row.toSign.includes(form.code));

  function sign(credentials: StepUpCredentials) {
    setError(null);
    startTransition(async () => {
      await flushRegisteredAutosaves();
      const result = await signIntakeFormsAction({ protocolId, ...credentials });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      router.refresh();
      showResult(result.result);
    });
  }

  return (
    <>
      <div className="rec-actions">
        <Button type="button" variant="primary" disabled={!row.agreed} onClick={() => setOpen(true)}>
          {label}
        </Button>
      </div>
      {!row.agreed ? <p className="caption rec-muted">Agree to the declarations and give the consents above first.</p> : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent title={label} data-testid="sign-dialog">
          <DialogDescription>
            You are signing {titles.map((form) => `${form.code} (${form.title})`).join(" and ")} with your saved signature. Each form keeps its own signed record, which
            anyone can verify from the reference printed on it.
          </DialogDescription>
          {signing.savedImageDataUrl ? (
            <div className="rec-sign__plate">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signing.savedImageDataUrl} alt="Your saved signature" />
            </div>
          ) : (
            <p className="body-sm">
              You have no saved signature yet. <Link href="/app/account/signature">Add one under My signature</Link>, then come back.
            </p>
          )}
          <StepUpConfirm prompt={signing.prompt} idPrefix="intake-sign" busy={pending} error={error} label={label} onConfirm={sign} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
