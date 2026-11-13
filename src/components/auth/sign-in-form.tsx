"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { GoogleMark } from "@/components/auth/google-mark";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { magicLinkLifetime } from "@/lib/magic-link";
import { sendMagicLink, signInWithGoogle, signInWithPassword } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";

const SENT_EMAIL_KEY = "recdms.signin.email";

type Mode = "password" | "link";
type FocusTarget = "password" | "link" | "email";

function InlineError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="signin-error" role="alert">
      <Icon icon={AlertCircle} size={16} />
      <span>{message}</span>
    </p>
  );
}

function errorOf(state: ActionState): string | undefined {
  return state?.error;
}

export function SignInForm({
  notice,
  pageError,
  linkSent,
  googleEnabled,
  callbackUrl = "",
}: {
  notice?: string;
  pageError?: string;
  linkSent: boolean;
  googleEnabled: boolean;
  callbackUrl?: string;
}) {
  const router = useRouter();
  const [passwordState, passwordAction, passwordPending] = useActionState(signInWithPassword, null);
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, null);
  const [googleState, googleAction, googlePending] = useActionState(signInWithGoogle, null);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hideSent, setHideSent] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const focusTarget = useRef<FocusTarget | null>(null);

  const showingSent = linkSent && !hideSent;

  useEffect(() => {
    if (!linkSent) return;
    setSentTo(sessionStorage.getItem(SENT_EMAIL_KEY) ?? "");
  }, [linkSent]);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "password") passwordRef.current?.focus();
    if (target === "link") linkButtonRef.current?.focus();
    if (target === "email") emailRef.current?.focus();
  }, [mode, showingSent]);

  function switchMode(next: Mode) {
    const typed = emailRef.current?.value ?? email;
    setEmail(typed);
    if (next === "link") setShowPassword(false);
    focusTarget.current = next === "password" ? "password" : typed ? "link" : "email";
    setMode(next);
  }

  function differentEmail() {
    sessionStorage.removeItem(SENT_EMAIL_KEY);
    setEmail("");
    setSentTo("");
    setHideSent(true);
    focusTarget.current = "email";
    setMode("password");
    const params = new URLSearchParams();
    if (callbackUrl) params.set("callbackUrl", callbackUrl);
    router.replace(params.size ? `/sign-in?${params}` : "/sign-in", { scroll: false });
  }

  const formError = mode === "password" ? errorOf(passwordState) : errorOf(linkState);

  return (
    <div className="signin-stack">
      {notice ? <p className="signin-banner">{notice}</p> : null}
      <form action={googleAction}>
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        <button
          className="rec-btn signin-google"
          type="submit"
          disabled={!googleEnabled || googlePending}
          aria-busy={googlePending || undefined}
        >
          <GoogleMark />
          <span>Continue with Google</span>
        </button>
        <InlineError message={errorOf(googleState)} />
      </form>
      <p className="signin-hint">
        {googleEnabled
          ? "Use any Google account. USC students and staff: use your @usc.edu.ph account. Other accounts wait for an administrator to approve them."
          : "Google sign-in is not configured on this server."}
      </p>
      <div className="signin-or" role="separator" aria-label="or use your email">
        <span />
        <p>or use your email</p>
        <span />
      </div>
      {showingSent ? (
        <div className="signin-sent">
          <p className="body">
            {sentTo
              ? `Check your email. We sent a sign-in link to ${sentTo}.`
              : "Check your email. We sent a sign-in link."}
          </p>
          <button className="signin-textbtn" type="button" onClick={differentEmail}>
            Use a different email
          </button>
        </div>
      ) : mode === "password" ? (
        <form action={passwordAction} className="signin-fields">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="signin-field">
            <label className="signin-label" htmlFor="sign-in-email">
              Email
            </label>
            <input
              ref={emailRef}
              className="rec-input"
              id="sign-in-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              autoCapitalize="none"
              spellCheck={false}
              required
              defaultValue={email}
            />
          </div>
          <div className="signin-pass">
            <label className="signin-label" htmlFor="sign-in-password">
              Password
            </label>
            <div className="signin-password">
              <input
                ref={passwordRef}
                className="rec-input"
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
              />
              <button
                className="signin-reveal"
                type="button"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <button className="signin-forgot" type="button" onClick={() => switchMode("link")}>
              Forgot password?
            </button>
          </div>
          <InlineError message={pageError ?? formError} />
          <Button className="signin-submit" type="submit" variant="primary" disabled={passwordPending} aria-busy={passwordPending || undefined}>
            Sign in
          </Button>
          <button className="signin-textbtn" type="button" onClick={() => switchMode("link")}>
            Email me a sign-in link instead
          </button>
        </form>
      ) : (
        <form
          action={linkAction}
          className="signin-fields"
          onSubmit={() => {
            const typed = emailRef.current?.value ?? "";
            if (typed) sessionStorage.setItem(SENT_EMAIL_KEY, typed);
          }}
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="signin-field">
            <label className="signin-label" htmlFor="sign-in-email">
              Email
            </label>
            <input
              ref={emailRef}
              className="rec-input"
              id="sign-in-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              autoCapitalize="none"
              spellCheck={false}
              required
              defaultValue={email}
            />
          </div>
          <p className="signin-note">
            We will email you a link that signs you in without a password. It works once and expires in {magicLinkLifetime()}.
          </p>
          <InlineError message={pageError ?? formError} />
          <Button
            ref={linkButtonRef}
            className="signin-submit"
            type="submit"
            variant="primary"
            disabled={linkPending}
            aria-busy={linkPending || undefined}
          >
            Email me a sign-in link
          </Button>
          <button className="signin-textbtn" type="button" onClick={() => switchMode("password")}>
            Use my password instead
          </button>
        </form>
      )}
    </div>
  );
}
