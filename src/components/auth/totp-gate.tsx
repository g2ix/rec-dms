"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { cleanTotpCode, TOTP_CHALLENGE_LIMIT, TOTP_CODE_LENGTH, TOTP_PATH } from "@/lib/totp-challenge";
import { signOutAction } from "@/server/auth/actions";
import { challengeTotpAction } from "@/server/auth/totp-actions";

type Phase = "idle" | "verifying" | "closing";

const EMPTY = Array.from({ length: TOTP_CODE_LENGTH }, () => "");
const LOCK_SECONDS = Math.round(TOTP_CHALLENGE_LIMIT.windowMs / 1000);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The post-sign-in authenticator check, drawn as a modal over a blurred, inert shell.
 * It cannot be dismissed: the only ways out are a matching code or "Sign out".
 */
export function TotpGate({
  background,
  next,
  roles,
  name,
  role,
}: {
  background: React.ReactNode;
  next: string;
  roles: string;
  name: string;
  role: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const introId = useId();
  const hintId = useId();
  const messageId = useId();
  const lostId = useId();
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lostOpen, setLostOpen] = useState(false);

  const locked = lockedUntil !== null;
  const busy = phase !== "idle";

  function focusBox(index: number) {
    const box = boxes.current[Math.max(0, Math.min(TOTP_CODE_LENGTH - 1, index))];
    box?.focus();
    box?.select();
  }

  useEffect(() => {
    // A client-side redirect to the check can leave the old address in the bar. Server actions post
    // to that address, and the guard refuses every page but the check, so put the check's own URL back.
    if (window.location.pathname !== TOTP_PATH) {
      const query = next === "/app" ? "" : `?next=${encodeURIComponent(next)}`;
      // `null` state: Next.js then syncs its router to the new URL.
      window.history.replaceState(null, "", `${TOTP_PATH}${query}`);
    }
    focusBox(0);
  }, [next]);

  useEffect(() => {
    if (lockedUntil === null) return;
    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockedUntil(null);
        setSecondsLeft(0);
        setError(null);
        // Wait for the inputs to be enabled again before moving focus.
        window.setTimeout(() => focusBox(0), 0);
        return;
      }
      setSecondsLeft(left);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  function lock() {
    setDigits(EMPTY);
    setError(null);
    setLockedUntil(Date.now() + LOCK_SECONDS * 1000);
  }

  function rejected(message: string) {
    setDigits(EMPTY);
    setError(message);
    setPhase("idle");
    window.setTimeout(() => focusBox(0), 0);
  }

  async function submit(code: string) {
    if (busy || locked) return;
    if (code.length !== TOTP_CODE_LENGTH) {
      setError("Enter all 6 digits of the code.");
      focusBox(digits.findIndex((digit) => !digit));
      return;
    }
    setPhase("verifying");
    setError(null);
    try {
      const result = await challengeTotpAction(code, next);
      if (result.status === "ok") {
        setPhase("closing");
        window.setTimeout(
          () => {
            router.replace(result.next);
            // The signed-in layout is shared with the target page, so draw it again without the check.
            router.refresh();
          },
          prefersReducedMotion() ? 120 : 240,
        );
        return;
      }
      if (result.status === "not-enrolled") {
        router.refresh();
        return;
      }
      setPhase("idle");
      if (result.status === "locked" || result.locked) {
        lock();
        return;
      }
      rejected("That code did not match. Check your app and try the newest code.");
    } catch {
      rejected("We could not check the code. Check your connection and try again.");
    }
  }

  /** Put `value` into the boxes starting at `start`, then move on or submit. */
  function fill(start: number, value: string) {
    const nextDigits = [...digits];
    let index = start;
    for (const char of value) {
      if (index >= TOTP_CODE_LENGTH) break;
      nextDigits[index] = char;
      index += 1;
    }
    setDigits(nextDigits);
    if (error) setError(null);
    if (nextDigits.every(Boolean)) {
      boxes.current[Math.min(index, TOTP_CODE_LENGTH) - 1]?.blur();
      void submit(nextDigits.join(""));
    } else {
      focusBox(index);
    }
  }

  function setDigit(index: number, value: string) {
    const nextDigits = [...digits];
    nextDigits[index] = value;
    setDigits(nextDigits);
  }

  function onChange(index: number, raw: string) {
    if (busy || locked) return;
    const clean = cleanTotpCode(raw);
    if (!/^\d*$/.test(clean)) return;
    if (clean.length === 0) {
      setDigit(index, "");
      return;
    }
    const previous = digits[index] ?? "";
    if (clean.length === 2 && previous && clean.startsWith(previous)) {
      fill(index, clean.slice(1));
      return;
    }
    // Autofill of a one-time code, or a paste the browser routed through `change`.
    fill(clean.length >= TOTP_CODE_LENGTH ? 0 : index, clean.slice(0, TOTP_CODE_LENGTH));
  }

  function onPaste(index: number, event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (busy || locked) return;
    const clean = cleanTotpCode(event.clipboardData.getData("text"));
    if (!/^\d+$/.test(clean)) return;
    fill(clean.length >= TOTP_CODE_LENGTH ? 0 : index, clean.slice(0, TOTP_CODE_LENGTH));
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const { key } = event;
    if (key === "Backspace") {
      event.preventDefault();
      if (busy || locked) return;
      if (digits[index]) {
        setDigit(index, "");
      } else if (index > 0) {
        setDigit(index - 1, "");
        focusBox(index - 1);
      }
      return;
    }
    if (key === "Delete") {
      event.preventDefault();
      if (!busy && !locked) setDigit(index, "");
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
      event.preventDefault();
      focusBox(index - 1);
      return;
    }
    if (key === "ArrowRight" || key === "ArrowDown") {
      event.preventDefault();
      focusBox(index + 1);
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      focusBox(0);
      return;
    }
    if (key === "End") {
      event.preventDefault();
      focusBox(TOTP_CODE_LENGTH - 1);
      return;
    }
    if (/^\d$/.test(key)) {
      event.preventDefault();
      if (!busy && !locked) fill(index, key);
      return;
    }
    // Anything else that would type a character is not a digit.
    if (key.length === 1) event.preventDefault();
  }

  return (
    <div className="rec-totp" data-state={phase === "closing" ? "closing" : "open"}>
      <div className="rec-totp__behind" inert aria-hidden="true">
        <div className="rec-totp__shell">{background}</div>
      </div>
      <div className="rec-totp__scrim" aria-hidden="true" />
      <div className="rec-totp__viewport">
        <div className="rec-totp__card" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={introId}>
          <div className="rec-totp__body">
            <header className="rec-totp__head">
              <span className="rec-totp__badge" aria-hidden="true">
                <Lock size={22} strokeWidth={1.75} />
              </span>
              <h1 id={titleId} className="rec-totp__title">
                Confirm it is you
              </h1>
              <p id={introId} className="rec-totp__intro">
                Enter the 6-digit code from your authenticator app. {roles} need this each time they sign in.
              </p>
            </header>
            <form
              className="rec-totp__form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void submit(digits.join(""));
              }}
            >
              <fieldset
                className="rec-otp"
                data-error={error ? "true" : undefined}
                disabled={locked}
                aria-describedby={`${hintId}${error || locked ? ` ${messageId}` : ""}`}
              >
                <legend className="rec-sr">Authenticator code</legend>
                <div className="rec-otp__boxes">
                  {digits.map((digit, index) => (
                    <span key={index} className="rec-otp__slot">
                      {index === 3 ? <span className="rec-otp__dash" aria-hidden="true" /> : null}
                      <input
                        ref={(node) => {
                          boxes.current[index] = node;
                        }}
                        className="rec-otp__box"
                        data-filled={digit ? "true" : undefined}
                        value={digit}
                        aria-label={`Digit ${index + 1} of ${TOTP_CODE_LENGTH}`}
                        aria-invalid={error ? true : undefined}
                        autoComplete={index === 0 ? "one-time-code" : "off"}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        readOnly={busy}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => onChange(index, event.currentTarget.value)}
                        onPaste={(event) => onPaste(index, event)}
                        onKeyDown={(event) => onKeyDown(index, event)}
                      />
                    </span>
                  ))}
                </div>
              </fieldset>
              {locked ? (
                <p id={messageId} className="rec-totp__error" role="alert">
                  {/* The count changes every second; screen readers hear the first value only. */}
                  <span aria-hidden="true">Too many tries. Wait {secondsLeft} seconds.</span>
                  <span className="rec-sr">Too many tries. Wait {LOCK_SECONDS} seconds.</span>
                </p>
              ) : error ? (
                <p id={messageId} className="rec-totp__error" role="alert">
                  {error}
                </p>
              ) : null}
              <p id={hintId} className="rec-totp__hint">
                The code changes every 30 seconds. Paste works too.
              </p>
              <button
                type="submit"
                className="rec-btn rec-btn--primary rec-totp__submit"
                disabled={busy || locked}
              >
                Verify and continue
              </button>
            </form>
          </div>
          <footer className="rec-totp__foot">
            <p className="rec-totp__who">
              Signed in as <strong>{name}</strong> · {role}
            </p>
            <div className="rec-totp__links">
              <button
                type="button"
                className="rec-totp__link"
                aria-expanded={lostOpen}
                aria-controls={lostId}
                onClick={() => setLostOpen((open) => !open)}
              >
                Lost your phone?
              </button>
              <form action={signOutAction}>
                <button type="submit" className="rec-totp__link rec-totp__link--muted">
                  Sign out
                </button>
              </form>
            </div>
            <div id={lostId} className="rec-totp__lost" hidden={!lostOpen}>
              <p>
                Ask a System Admin to reset your authenticator. They turn it off for your account, and you set it up again on your new
                phone the next time you sign in. If you do not know who your System Admin is, contact the REC Secretariat.
              </p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
