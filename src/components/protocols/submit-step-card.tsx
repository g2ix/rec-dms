"use client";

import { useState, useTransition } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { useActionResult } from "@/components/ui/action-result";
import { revealChecklist } from "@/components/protocols/submission-checklist";
import type { ActionOutcome } from "@/lib/action-result";
import { flushRegisteredAutosaves } from "@/lib/forms/flush-registry";

/**
 * The proponent's submit form. The button stays enabled: with items missing it points at the
 * checklist instead of sending. It is disabled only while the request is in flight.
 */
export function SubmitStepForm({
  action,
  taskId,
  protocolId,
  ready,
  summary,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<ActionOutcome>;
  taskId: string;
  protocolId: string;
  ready: boolean;
  summary: string;
  submitLabel: string;
}) {
  const show = useActionResult();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
      setError(null);
      revealChecklist();
      return;
    }
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
    <form onSubmit={submit} className="rec-step__form">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="protocolId" value={protocolId} />
      <label className="rec-field rec-field--wide">
        <span className="label">Note to REC Staff (optional)</span>
        <textarea className="rec-input" name="comment" rows={3} />
      </label>
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rec-step__foot">
        <p className={ready ? "label rec-step__summary rec-step__summary--ready" : "label rec-step__summary"} aria-live="polite">
          {summary}
        </p>
        <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Submitting…">
          {submitLabel}
        </BusyButton>
      </div>
    </form>
  );
}
