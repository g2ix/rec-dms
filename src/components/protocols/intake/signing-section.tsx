"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { Icon } from "@/components/icons";
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
export function IntakeSigningSection({ protocolId, signing, agreeing = false }: { protocolId: string; signing: IntakeSigningView; agreeing?: boolean }) {
  const codes = signing.forms.map((form) => form.code);
  const mine = signing.rows.find((row) => row.mine);
  // Signing uses the saved signature, so say so up front instead of inside the dialog.
  const needsSignature = Boolean(mine && mine.state !== "signed" && signing.editable && !signing.hasSavedSignature);
  return (
    <div className="rec-stack" data-testid="signing">
      <h3 className="subheading">Sign {andList(codes)}</h3>
      <p className="body-sm rec-muted">
        {codes.length > 1 ? "One signature covers both forms." : `Your signature goes on ${codes[0] ?? "the form"}.`} Every researcher signs on their own account.
      </p>
      {needsSignature ? (
        <div className="rec-banner rec-sign-missing" role="status" data-testid="signature-missing">
          <Icon icon={PenLine} size={18} />
          <div>
            <p className="label">You have no saved signature yet</p>
            <p className="body-sm">
              Signing places your saved signature on {andList(codes)}. <Link href="/app/account/signature">Add one under My signature</Link>, then come back to sign.
            </p>
          </div>
        </div>
      ) : null}
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
                <td>{row.mine ? <MyRow protocolId={protocolId} row={row} signing={signing} agreeing={agreeing} /> : row.state === "signed" ? "Signed" : "Not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyRow({ protocolId, row, signing, agreeing }: { protocolId: string; row: SigningRow; signing: IntakeSigningView; agreeing: boolean }) {
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
      {signing.editable ? <SignDialog protocolId={protocolId} row={row} signing={signing} agreeing={agreeing} /> : null}
    </div>
  );
}

function SignDialog({ protocolId, row, signing, agreeing }: { protocolId: string; row: SigningRow; signing: IntakeSigningView; agreeing: boolean }) {
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
        <BusyButton
          type="button"
          variant="primary"
          busy={agreeing}
          busyLabel="Saving your answers…"
          disabled={!row.agreed || !signing.hasSavedSignature}
          onClick={() => setOpen(true)}
        >
          {label}
        </BusyButton>
      </div>
      {agreeing ? (
        <p className="caption rec-muted" role="status">
          The Sign button turns on once your answers above are saved.
        </p>
      ) : !row.agreed ? (
        <p className="caption rec-muted">Agree to the declarations and give the consents above first.</p>
      ) : !signing.hasSavedSignature ? (
        <p className="caption rec-muted">
          Add your signature under <Link href="/app/account/signature">My signature</Link> first.
        </p>
      ) : null}
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
