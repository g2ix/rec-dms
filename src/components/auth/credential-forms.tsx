"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  sendMagicLink,
  signInWithGoogle,
  signInWithPassword,
  signUpAction,
  verifyEmailAction,
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

export function SignInForm({ notice, googleEnabled }: { notice?: string; googleEnabled: boolean }) {
  const [passwordState, passwordAction, passwordPending] = useActionState(signInWithPassword, null);
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, null);
  const [googleState, googleAction, googlePending] = useActionState(signInWithGoogle, null);

  return (
    <div className="auth-form">
      <h2 className="heading">Sign in</h2>
      {notice ? <p className="rec-banner">{notice}</p> : null}
      <FormError state={passwordState} />
      <form action={passwordAction} className="auth-form">
        <Field label="Email" htmlFor="sign-in-email">
          <Input id="sign-in-email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="sign-in-password">
          <Input id="sign-in-password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <BusyButton type="submit" variant="primary" busy={passwordPending} busyLabel="Signing in…">
          Sign in
        </BusyButton>
      </form>
      <form action={linkAction} className="auth-form">
        <FormError state={linkState} />
        <Field label="Email a sign-in link" htmlFor="magic-email" help="For an email already on your account.">
          <Input id="magic-email" name="email" type="email" autoComplete="email" required />
        </Field>
        <BusyButton type="submit" busy={linkPending} busyLabel="Sending…">
          Email me a sign-in link
        </BusyButton>
      </form>
      <form action={googleAction}>
        <FormError state={googleState} />
        <BusyButton type="submit" busy={googlePending} busyLabel="Opening Google…" disabled={!googleEnabled}>
          Continue with Google
        </BusyButton>
      </form>
      {!googleEnabled ? <p className="caption rec-muted">Google sign-in is not configured on this server.</p> : null}
      <p className="body-sm">
        New to REC-DMS? <Link href="/sign-up">Create an account</Link>
      </p>
    </div>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, null);
  return (
    <form action={action} className="auth-form">
      <h2 className="heading">Create an account</h2>
      <p className="body-sm rec-muted">Name as it should appear on REC forms, for example Juan D. Cruz.</p>
      <FormError state={state} />
      <Field label="First name" htmlFor="first-name">
        <Input id="first-name" name="firstName" autoComplete="given-name" required />
      </Field>
      <Field label="Middle initial" htmlFor="middle-initial" optional>
        <Input id="middle-initial" name="middleInitial" maxLength={2} autoComplete="additional-name" />
      </Field>
      <Field label="Family name" htmlFor="family-name">
        <Input id="family-name" name="familyName" autoComplete="family-name" required />
      </Field>
      <Field label="Email" htmlFor="sign-up-email">
        <Input id="sign-up-email" name="email" type="email" autoComplete="email" required />
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
