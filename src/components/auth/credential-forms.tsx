"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, verifyEmailAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { NameFields } from "@/components/account/name-fields";
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

export function SignUpForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <form action={action} className="auth-form">
      <h2 className="heading">Create an account</h2>
      <p className="body-sm rec-muted">The short name on screens is Juan D. Cruz. Titles and degrees print on the REC forms.</p>
      <FormError state={state} />
      <NameFields />
      <Field label="Email" htmlFor="sign-up-email">
        <Input id="sign-up-email" name="email" type="email" autoComplete="email" required defaultValue={defaultEmail} />
      </Field>
      <Field label="Password" htmlFor="sign-up-password" help="At least 12 characters, and not a common phrase.">
        <Input id="sign-up-password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Sending code…">
        Create account
      </BusyButton>
      <p className="body-sm">
        Already registered? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}

export function VerifyForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(verifyEmailAction, null);
  return (
    <form action={action} className="auth-form">
      <h2 className="heading">Verify email</h2>
      <p className="body-sm">Enter the 6-digit code sent to {email}.</p>
      <FormError state={state} />
      <input type="hidden" name="email" value={email} />
      <Field label="Code" htmlFor="verify-code">
        <Input id="verify-code" name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Verifying…">
        Verify email
      </BusyButton>
    </form>
  );
}
