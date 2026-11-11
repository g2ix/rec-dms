"use client";

import { useActionState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { saveSettingAction } from "@/server/settings/actions";

/** Edits one setting as JSON, now or from a later date. */
export function SettingForm({ settingKey, value, fixedKey }: { settingKey: string; value: string; fixedKey: boolean }) {
  const [state, action, pending] = useActionState(saveSettingAction, null);
  return (
    <form action={action} className="rec-form">
      {state?.error ? (
        <p className="rec-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {fixedKey ? (
        <input type="hidden" name="key" value={settingKey} />
      ) : (
        <label className="rec-field">
          <span className="label">Key</span>
          <input className="rec-input" name="key" defaultValue={settingKey} required />
        </label>
      )}
      <label className="rec-field rec-field--wide">
        <span className="label">Value (JSON)</span>
        <textarea className="rec-input rec-textarea code" name="value" rows={Math.min(14, Math.max(2, value.split("\n").length))} defaultValue={value} required />
      </label>
      <label className="rec-field">
        <span className="label">Starts on (optional)</span>
        <input className="rec-input" type="date" name="effectiveFrom" />
      </label>
      <BusyButton type="submit" busy={pending} busyLabel="Saving…">
        Save
      </BusyButton>
    </form>
  );
}
