"use client";

import { useActionState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { createDefinitionAction } from "@/server/forms/actions";
import type { ActionState } from "@/server/action-state";

export function NewForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(createDefinitionAction, null);
  const error = (state as ActionState)?.error;

  return (
    <form action={action} className="rec-form">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <label className="label" htmlFor="code">
        Code
      </label>
      <input id="code" name="code" className="rec-input" required placeholder="F-27" />
      <label className="label" htmlFor="title">
        Title
      </label>
      <input id="title" name="title" className="rec-input" required />
      <label className="label" htmlFor="version">
        Version
      </label>
      <input id="version" name="version" className="rec-input" required placeholder="09-00" />
      <label className="label" htmlFor="effectiveDate">
        Effective date
      </label>
      <input id="effectiveDate" name="effectiveDate" className="rec-input" type="date" required defaultValue={today} />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Creating…">
        Create form
      </BusyButton>
    </form>
  );
}
