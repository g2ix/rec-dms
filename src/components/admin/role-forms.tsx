"use client";

import { useActionState, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import type { ActionState } from "@/server/action-state";
import { changePanelChairAction, grantRoleAction, revokeRoleAction } from "@/server/users/actions";

function FormError({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p className="rec-alert" role="alert">
      {state.error}
    </p>
  );
}

export function GrantRoleForm({
  userId,
  roles,
  panels,
}: {
  userId: string;
  roles: { id: string; name: string; perPanel: boolean }[];
  panels: { id: string; code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(grantRoleAction, null);
  const [roleId, setRoleId] = useState("");
  const perPanel = roles.find((role) => role.id === roleId)?.perPanel ?? false;
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field label="Role" htmlFor="grant-role">
        <select id="grant-role" name="roleId" className="rec-select" required value={roleId} onChange={(event) => setRoleId(event.target.value)}>
          <option value="">Choose a role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </Field>
      {perPanel ? (
        <Field label="Panel" htmlFor="grant-panel">
          <select id="grant-panel" name="panelId" className="rec-select" required defaultValue="">
            <option value="">Choose a panel</option>
            {panels.map((panel) => (
              <option key={panel.id} value={panel.id}>
                {panel.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <div className="rec-actions">
        <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Granting…">
          Grant role
        </BusyButton>
      </div>
    </form>
  );
}

export function RevokeRoleForm({ userId, userRoleId, roleName }: { userId: string; userRoleId: string; roleName: string }) {
  const [state, action, pending] = useActionState(revokeRoleAction, null);
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="userRoleId" value={userRoleId} />
      <Field label={`Reason for revoking ${roleName}`} htmlFor={`revoke-${userRoleId}`}>
        <input id={`revoke-${userRoleId}`} name="reason" className="rec-input" required maxLength={500} />
      </Field>
      <div className="rec-actions">
        <BusyButton type="submit" variant="danger" busy={pending} busyLabel="Revoking…">
          Revoke role
        </BusyButton>
      </div>
    </form>
  );
}

export function ChangeChairForm({
  panelId,
  candidates,
  reasonRequired,
}: {
  panelId: string;
  candidates: { id: string; label: string }[];
  reasonRequired: boolean;
}) {
  const [state, action, pending] = useActionState(changePanelChairAction, null);
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <input type="hidden" name="panelId" value={panelId} />
      <Field label="New Panel Chair" htmlFor="new-chair">
        <select id="new-chair" name="newChairUserId" className="rec-select" required defaultValue="">
          <option value="">Choose a person</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </Field>
      {reasonRequired ? (
        <Field label="Reason for the change" htmlFor="chair-reason">
          <input id="chair-reason" name="reason" className="rec-input" required maxLength={500} />
        </Field>
      ) : null}
      <div className="rec-actions">
        <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…" disabled={candidates.length === 0}>
          Save Panel Chair
        </BusyButton>
      </div>
    </form>
  );
}
