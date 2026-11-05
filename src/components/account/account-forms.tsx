"use client";

import { useActionState } from "react";
import { useState } from "react";
import {
  addEmailAction,
  confirmEmailAction,
  confirmStepUpAction,
  linkGoogleAction,
  setPasswordAction,
} from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function FormError({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p className="rec-alert" role="alert">
      {state.error}
    </p>
  );
}

export function LinkGoogleForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(linkGoogleAction, null);
  return (
    <form action={action} className="rec-stack">
      <FormError state={state} />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Opening Google…" disabled={!enabled}>
        Link Google account
      </BusyButton>
      {!enabled ? <p className="caption rec-muted">Google sign-in is not configured on this server.</p> : null}
    </form>
  );
}

export function AddEmailForm() {
  const [state, action, pending] = useActionState(addEmailAction, null);
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <Field label="Email" htmlFor="add-email" help="We send a code before it can be used to sign in.">
        <Input id="add-email" name="email" type="email" autoComplete="email" required />
      </Field>
      <BusyButton type="submit" busy={pending} busyLabel="Sending code…">
        Add email
      </BusyButton>
    </form>
  );
}

export function ConfirmEmailForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(confirmEmailAction, null);
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <input type="hidden" name="email" value={email} />
      <Field label="Code" htmlFor="link-code" help={`Sent to ${email}.`}>
        <Input id="link-code" name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Confirming…">
        Confirm email
      </BusyButton>
    </form>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action, pending] = useActionState(setPasswordAction, null);
  return (
    <form action={action} className="rec-form">
      <h2 className="heading">{hasPassword ? "Change password" : "Set password"}</h2>
      <FormError state={state} />
      {hasPassword ? (
        <Field label="Current password" htmlFor="current-password">
          <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required />
        </Field>
      ) : null}
      <Field label="New password" htmlFor="new-password" help="At least 12 characters, and not a common phrase.">
        <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…">
        {hasPassword ? "Change password" : "Set password"}
      </BusyButton>
    </form>
  );
}

export function StepUpForm({
  sessionId,
  side,
  email,
  hasPassword,
}: {
  sessionId: string;
  side: "primary" | "secondary";
  email: string;
  hasPassword: boolean;
}) {
  const [state, action, pending] = useActionState(confirmStepUpAction, null);
  const [mode, setMode] = useState<"password" | "code">(hasPassword ? "password" : "code");
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="side" value={side} />
      <input type="hidden" name="email" value={email} />
      {hasPassword ? (
        <div className="rec-actions">
          <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setMode("password")}>
            Use password
          </button>
          <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setMode("code")}>
            Use email code
          </button>
        </div>
      ) : null}
      {mode === "password" ? (
        <Field label="Password" htmlFor={`${side}-password`}>
          <Input id={`${side}-password`} name="password" type="password" autoComplete="current-password" />
        </Field>
      ) : (
        <Field label="Code" htmlFor={`${side}-code`} help={`Sent to ${email}.`}>
          <Input id={`${side}-code`} name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} />
        </Field>
      )}
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Checking…">
        Confirm this account
      </BusyButton>
    </form>
  );
}
