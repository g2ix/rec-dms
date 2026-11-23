"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { changePanelChairAction } from "@/server/users/actions";

type Candidate = { id: string; name: string; email: string | null; roles: string[]; onPanel: boolean };

/** People are listed as cards you click to select; the chosen one is restated on the save button. */
export function ChangeChairForm({
  panelId,
  panelName,
  candidates,
  reasonRequired,
}: {
  panelId: string;
  panelName: string;
  candidates: Candidate[];
  reasonRequired: boolean;
}) {
  const [state, action, pending] = useActionState(changePanelChairAction, null);
  const [chosen, setChosen] = useState<string>("");
  const person = candidates.find((candidate) => candidate.id === chosen);

  return (
    <form action={action} className="rec-stack">
      <input type="hidden" name="panelId" value={panelId} />
      <input type="hidden" name="newChairUserId" value={chosen} />
      <div className="rec-pick-list" role="radiogroup" aria-label="New Panel Chair">
        {candidates.map((candidate) => {
          const on = candidate.id === chosen;
          return (
            <button
              key={candidate.id}
              type="button"
              role="radio"
              aria-checked={on}
              className="rec-pick"
              onClick={() => setChosen(on ? "" : candidate.id)}
            >
              <span className="rec-pick__mark" aria-hidden="true">
                {on ? <Icon icon={Check} size={16} /> : null}
              </span>
              <span className="rec-pick__who">
                <span className="subheading">{candidate.name}</span>
                <span className="body-sm rec-muted">{candidate.email ?? "No email"}</span>
              </span>
              <span className="rec-pick__roles">
                {candidate.onPanel ? <span className="rec-role-chip rec-role-chip--account">On this panel</span> : null}
                {candidate.roles.slice(0, 3).map((role) => (
                  <span key={role} className="rec-role-chip">
                    {role}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rec-savebar" aria-live="polite">
        <p className="body">{person ? <>New chair of {panelName}: <strong>{person.name}</strong></> : "Select a person above."}</p>
        {reasonRequired ? (
          <Field label="Reason for the change (kept in the audit log)" htmlFor="chair-reason">
            <input id="chair-reason" name="reason" className="rec-input" required maxLength={500} />
          </Field>
        ) : (
          <input type="hidden" name="reason" value="" />
        )}
        {state?.error ? (
          <p className="rec-alert" role="alert">
            {state.error}
          </p>
        ) : null}
        <div className="rec-actions">
          <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…" disabled={!person}>
            {person ? `Make ${person.name} the Panel Chair` : "Save Panel Chair"}
          </BusyButton>
        </div>
      </div>
    </form>
  );
}
