"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import { BusyButton } from "@/components/ui/busy-button";
import { saveStartRoleAction } from "@/server/auth/actions";
import type { RoleView } from "@/lib/role-view";

type Option = { value: RoleView | "last"; title: string; detail: string };

/** One card per role the person holds, plus "the role I used last". */
export function StartRoleForm({ options, saved }: { options: Option[]; saved: RoleView | "last" }) {
  const [state, action, pending] = useActionState(saveStartRoleAction, null);
  const [chosen, setChosen] = useState<RoleView | "last">(saved);
  const savedValue = state?.ok ? (state.saved as RoleView | "last") : saved;
  const changed = chosen !== savedValue;

  return (
    <form action={action} className="rec-stack">
      <input type="hidden" name="startRole" value={chosen} />
      <div className="rec-pick-list rec-pick-list--all" role="radiogroup" aria-label="Open REC-DMS as">
        {options.map((option) => {
          const on = option.value === chosen;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className="rec-pick"
              onClick={() => setChosen(option.value)}
            >
              <span className="rec-pick__mark" aria-hidden="true">
                {on ? <Icon icon={Check} size={16} /> : null}
              </span>
              <span className="rec-pick__who">
                <span className="subheading">{option.title}</span>
                <span className="body-sm rec-muted">{option.detail}</span>
              </span>
              {option.value === savedValue ? (
                <span className="rec-pick__roles">
                  <span className="rec-role-chip rec-role-chip--account">Saved</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {state && !state.ok ? (
        <p className="rec-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok && !changed ? (
        <p className="body-sm" role="status">
          Saved. The next time you sign in, REC-DMS opens in this role.
        </p>
      ) : null}
      <div className="rec-actions">
        <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…" disabled={!changed}>
          Save start role
        </BusyButton>
      </div>
    </form>
  );
}
