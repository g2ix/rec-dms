"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionResult } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { StatusBadge } from "@/components/ui/status-badge";
import { flushRegisteredAutosaves } from "@/lib/forms/flush-registry";
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sign(credentials: StepUpCredentials) {
    setError(null);
    startTransition(async () => {
      await flushRegisteredAutosaves();
      const result = await signFieldAction({ instanceId: signing.instanceId, fieldPath: slot.fieldPath, ...credentials });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
      showResult(result.result);
    });
  }

  return <StepUpConfirm prompt={signing} idPrefix={slot.fieldPath} busy={pending} error={error} onConfirm={sign} />;
}

export type StepUpCredentials = { password?: string; code?: string; totp?: string };

type StepUpMethod = "authenticator" | "password" | "email";

/**
 * The confirmation before a signature: nothing while a recent one still holds. Otherwise the
 * current code from the authenticator app (when one is set up), or the password, or for accounts
 * without one a 6-digit code emailed to the contact email.
 */
export function StepUpConfirm({
  prompt,
  idPrefix,
  busy,
  error,
  label = "Sign",
  onConfirm,
}: {
  prompt: { hasPassword: boolean; hasAuthenticator: boolean; fresh: boolean; email: string | null };
  idPrefix: string;
  busy: boolean;
  error: string | null;
  label?: string;
  onConfirm: (credentials: StepUpCredentials) => void;
}) {
  const fallback: StepUpMethod = prompt.hasPassword ? "password" : "email";
  const [method, setMethod] = useState<StepUpMethod>(prompt.hasAuthenticator ? "authenticator" : fallback);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();

  function confirm() {
    if (prompt.fresh) return onConfirm({});
    if (method === "authenticator") return onConfirm({ totp: totp.replace(/\s/g, "") });
    if (method === "password") return onConfirm({ password });
    onConfirm({ code });
  }

  function sendCode() {
    setSendError(null);
    startSending(async () => {
      const result = await sendSigningCodeAction();
      if (result?.error) {
        setSendError(result.error);
        return;
      }
      setSent(true);
    });
  }

  const shown = error ?? sendError;
  const signButton = (disabled = false) => (
    <BusyButton type="button" variant="primary" busy={busy} busyLabel="Signing…" onClick={confirm} disabled={disabled}>
      {label}
    </BusyButton>
  );
  return (
    <div className="rec-stack">
      {shown ? (
        <p className="rec-alert" role="alert">
          {shown}
        </p>
      ) : null}
      {prompt.fresh ? (
        signButton()
      ) : (
        <>
          {prompt.hasAuthenticator ? (
            <RadioGroup label="Confirm it is you with">
              <Radio name={`sign-method-${idPrefix}`} label="Authenticator app" checked={method === "authenticator"} onChange={() => setMethod("authenticator")} />
              <Radio
                name={`sign-method-${idPrefix}`}
                label={fallback === "password" ? "Password" : "Emailed code"}
                checked={method === fallback}
                onChange={() => setMethod(fallback)}
              />
            </RadioGroup>
          ) : null}
          {method === "authenticator" ? (
            <>
              <Field label="Authenticator code" htmlFor={`sign-totp-${idPrefix}`} help="The 6-digit code your authenticator app shows now. This lasts 10 minutes for signing.">
                <Input
                  id={`sign-totp-${idPrefix}`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={totp}
                  onChange={(event) => setTotp(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && totp.replace(/\s/g, "").length === 6) confirm();
                  }}
                />
              </Field>
              {signButton(totp.replace(/\s/g, "").length !== 6)}
            </>
          ) : method === "password" ? (
            <>
              <Field label="Password" htmlFor={`sign-password-${idPrefix}`} help="Confirm it is you. This lasts 10 minutes for signing.">
                <Input
                  id={`sign-password-${idPrefix}`}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              {signButton()}
            </>
          ) : (
            <>
              <p className="body-sm rec-muted">
                {prompt.email ? `We email a code to ${prompt.email}.` : "A code is emailed to your contact email."} It confirms it is you for 10 minutes.
              </p>
              <div className="rec-actions">
                <BusyButton type="button" busy={sending} busyLabel="Sending…" onClick={sendCode}>
                  Email a code
                </BusyButton>
                {signButton(!sent || code.trim().length < 6)}
              </div>
              {sent ? (
                <Field label="Code" htmlFor={`sign-code-${idPrefix}`}>
                  <Input
                    id={`sign-code-${idPrefix}`}
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
        </>
      )}
    </div>
  );
}
