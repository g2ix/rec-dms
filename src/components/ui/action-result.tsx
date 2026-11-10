"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { Dialog, DialogContent, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { ActionOutcome, ActionResult } from "@/lib/action-result";
import { flushRegisteredAutosaves } from "@/lib/forms/flush-registry";

const ShowResult = createContext<(result: ActionResult) => void>(() => {});

/** Opens the confirmation dialog. Outside the signed-in shell it does nothing. */
export function useActionResult(): (result: ActionResult) => void {
  return useContext(ShowResult);
}

/**
 * One dialog for every action that succeeds. It sits above the page so it stays open
 * when the page refreshes and the form that opened it is gone. Closing it any way goes to `href`.
 */
export function ActionResultProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [navigating, startNavigation] = useTransition();

  const show = useCallback((next: ActionResult) => {
    setResult(next);
    setOpen(true);
  }, []);

  function leave() {
    if (!result || leaving) return;
    // The action already refreshed this page, so there is nothing to load.
    if (result.href === pathname) {
      setOpen(false);
      return;
    }
    setLeaving(true);
    startNavigation(() => router.push(result.href));
  }

  useEffect(() => {
    if (!leaving || navigating) return;
    setLeaving(false);
    setOpen(false);
  }, [leaving, navigating]);

  return (
    <ShowResult.Provider value={show}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) leave();
        }}
      >
        <DialogContent title={result?.title} showCloseButton={false} data-testid="action-result">
          {result?.body ? <DialogDescription>{result.body}</DialogDescription> : null}
          <DialogFooter>
            <BusyButton type="button" variant="primary" busy={leaving} busyLabel="Opening…" onClick={leave}>
              OK
            </BusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ShowResult.Provider>
  );
}

/**
 * A form whose action reports an ActionOutcome. Success opens the result dialog.
 * An error stays inline above the button, and the fields keep what was typed.
 */
export function ActionForm({
  action,
  submitLabel,
  busyLabel,
  variant = "primary",
  className,
  children,
}: {
  action: (formData: FormData) => Promise<ActionOutcome>;
  submitLabel: React.ReactNode;
  busyLabel: React.ReactNode;
  variant?: React.ComponentProps<typeof BusyButton>["variant"];
  className?: string;
  children?: React.ReactNode;
}) {
  const show = useActionResult();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        await flushRegisteredAutosaves();
        const outcome = await action(data);
        if (outcome.ok) show(outcome.result);
        else setError(outcome.error);
      } catch {
        setError("That did not go through. Check your connection and try again.");
      }
    });
  }

  return (
    <form onSubmit={submit} className={className}>
      {children}
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <BusyButton type="submit" variant={variant} busy={pending} busyLabel={busyLabel}>
        {submitLabel}
      </BusyButton>
    </form>
  );
}
