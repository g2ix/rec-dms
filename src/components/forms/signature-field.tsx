"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionResult } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import type { FormField } from "@/lib/forms/schema";
import type { SignatureSlotView, SigningPrompt } from "@/lib/signatures/view";
import { sendSigningCodeAction, signFieldAction } from "@/server/signatures/actions";

export function SignatureFields({
  field,
  slots,
  signing,
}: {
  field: FormField;
  slots: SignatureSlotView[];
  signing: SigningPrompt | null;
}) {
  return (
    <div className="rec-field rec-field--wide">
      <p className="label" id={`${field.id}-label`}>
        {field.label}
        {field.validation?.required ? null : <span className="rec-muted"> (optional)</span>}
      </p>
      {field.help ? <p className="rec-field__help">{field.help}</p> : null}
      {slots.length === 0 ? (
        <p className="body-sm rec-muted">This signature is collected when the form names who signs it.</p>
      ) : (
        <div className="rec-sign" role="group" aria-labelledby={`${field.id}-label`}>
          {slots.map((slot) => (
            <SignatureSlot key={slot.fieldPath} slot={slot} signing={signing} />
          ))}
        </div>
      )}
    </div>
  );
}

function SignatureSlot({ slot, signing }: { slot: SignatureSlotView; signing: SigningPrompt | null }) {
  return (
    <div className="rec-sign__slot">
      <p className="body-sm">{slot.label}</p>
      {slot.status === "void" ? (
        <p className="rec-sign__void" role="status">
          <StatusBadge tone="danger" label="Signature void — re-sign required" />
        </p>
      ) : null}
      {slot.status !== "unsigned" && slot.imageDataUrl ? (
        <div className="rec-sign__plate">
          {/* The plate stays white in dark mode so the ink stays readable. */}
          {/* Data URL of a private signature. next/image does not load these. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slot.imageDataUrl} alt={`Signature of ${slot.signerName ?? slot.label}`} />
        </div>
      ) : null}
      {slot.status !== "unsigned" && slot.signerName && slot.signedAtLabel ? (
        <p className="rec-sign__meta caption">
          <span>Signed electronically by {slot.signerName}, {slot.signedAtLabel}</span>
          {slot.verifyRef ? <span className="code">{slot.verifyRef}</span> : null}
        </p>
      ) : null}
      {slot.status === "unsigned" && !slot.canSign && slot.waiting ? <p className="body-sm rec-muted">{slot.waiting}</p> : null}
      {slot.canSign && signing ? <SignPrompt slot={slot} signing={signing} /> : null}
      {slot.canSign && !signing ? <p className="body-sm rec-muted">Open this form on the protocol to sign.</p> : null}
    </div>
  );
}

function SignPrompt({ slot, signing }: { slot: SignatureSlotView; signing: SigningPrompt }) {
  const router = useRouter();
  const showResult = useActionResult();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sign() {
    setError(null);
    startTransition(async () => {
      const result = await signFieldAction({
        instanceId: signing.instanceId,
        fieldPath: slot.fieldPath,
        password: signing.hasPassword && !signing.fresh ? password : undefined,
        code: !signing.hasPassword && !signing.fresh ? code : undefined,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
      showResult(result.result);
    });
  }

  function sendCode() {
    setError(null);
    startTransition(async () => {
      const result = await sendSigningCodeAction();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSent(true);
    });
  }

  return (
    <div className="rec-stack">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      {signing.fresh ? (
        <BusyButton type="button" variant="primary" busy={pending} busyLabel="Signing…" onClick={sign}>
          Sign
        </BusyButton>
      ) : signing.hasPassword ? (
        <>
          <Field label="Password" htmlFor={`sign-password-${slot.fieldPath}`} help="Confirm it is you. This lasts 10 minutes for signing.">
            <Input
              id={`sign-password-${slot.fieldPath}`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <BusyButton type="button" variant="primary" busy={pending} busyLabel="Signing…" onClick={sign}>
            Sign
          </BusyButton>
        </>
      ) : (
        <>
          <p className="body-sm rec-muted">
            {signing.email ? `We email a code to ${signing.email}.` : "A code is emailed to your contact email."} It confirms it is you for 10 minutes.
          </p>
          <div className="rec-actions">
            <BusyButton type="button" busy={pending} busyLabel="Sending…" onClick={sendCode}>
              Email a code
            </BusyButton>
            <BusyButton type="button" variant="primary" busy={pending} busyLabel="Signing…" onClick={sign} disabled={!sent || code.trim().length < 6}>
              Sign
            </BusyButton>
          </div>
          {sent ? (
            <Field label="Code" htmlFor={`sign-code-${slot.fieldPath}`}>
              <Input
                id={`sign-code-${slot.fieldPath}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                minLength={6}
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          ) : null}
        </>
      )}
    </div>
  );
}
