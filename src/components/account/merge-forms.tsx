"use client";

import { useActionState } from "react";
import { adminMergeAction, completeMergeAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";

function FormError({ state }: { state: ActionState }) {
  if (!state?.error) return null;
  return (
    <p className="rec-alert" role="alert">
      {state.error}
    </p>
  );
}

export function CompleteMergeForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(completeMergeAction, null);
  return (
    <form action={action} className="rec-stack">
      <FormError state={state} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Merging…">
        Merge accounts
      </BusyButton>
    </form>
  );
}

export function AdminMergeForm({
  users,
}: {
  users: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(adminMergeAction, null);
  return (
    <form action={action} className="rec-form">
      <FormError state={state} />
      <Field label="First account" htmlFor="first-user">
        <select id="first-user" name="firstUserId" className="rec-select" required defaultValue={users[0]?.id}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Second account" htmlFor="second-user">
        <select id="second-user" name="secondUserId" className="rec-select" required defaultValue={users[1]?.id ?? users[0]?.id}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account to keep" htmlFor="keep">
        <select id="keep" name="keep" className="rec-select" defaultValue="first">
          <option value="first">Keep the first account</option>
          <option value="second">Keep the second account</option>
        </select>
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Merging…" disabled={users.length < 2}>
        Merge accounts
      </BusyButton>
    </form>
  );
}
