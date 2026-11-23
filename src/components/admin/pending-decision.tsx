"use client";

import { useActionState, useState } from "react";
import { BusyButton } from "@/components/ui/busy-button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { ROLE_INFO, type AccountRoleKey } from "@/lib/users/role-authority";
import { approvePendingUserAction, askToCompleteProfileAction, rejectPendingUserAction } from "@/server/users/actions";

const CHOICES: { key: AccountRoleKey; name: string }[] = [
  { key: "PROPONENT", name: "Proponent" },
  { key: "ADVISER", name: "Adviser" },
];

function joinNames(keys: AccountRoleKey[]): string {
  const names = CHOICES.filter((choice) => keys.includes(choice.key)).map((choice) => choice.name);
  return names.join(" and ");
}

export function PendingDecision({
  userId,
  name,
  complete,
  suggested,
}: {
  userId: string;
  name: string;
  complete: boolean;
  suggested: AccountRoleKey[];
}) {
  const [chosen, setChosen] = useState<AccountRoleKey[]>(suggested);
  const [approveState, approve, approving] = useActionState(approvePendingUserAction, null);
  const [rejectState, reject, rejecting] = useActionState(rejectPendingUserAction, null);
  const [askState, ask, asking] = useActionState(askToCompleteProfileAction, null);
  const error = approveState?.error ?? rejectState?.error ?? askState?.error;

  const toggle = (key: AccountRoleKey) =>
    setChosen((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  return (
    <section className="rec-pending__decide" aria-label={`Decision for ${name}`}>
      <h3 className="label rec-pending__label">Approve as</h3>
      <div className="rec-choice-cards" role="group" aria-label="Account type">
        {CHOICES.map((choice) => {
          const on = chosen.includes(choice.key);
          return (
            <button
              key={choice.key}
              type="button"
              className="rec-choice-card"
              aria-pressed={on}
              onClick={() => toggle(choice.key)}
              disabled={!complete}
            >
              <span className="rec-choice-card__box" aria-hidden="true" />
              <span>
                <span className="subheading">{choice.name}</span>
                <span className="body-sm rec-muted">{ROLE_INFO[choice.key]!.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="rec-actions">
        {complete ? (
          <Dialog>
            <DialogTrigger className="rec-btn rec-btn--primary" disabled={chosen.length === 0}>
              <span>{chosen.length === 0 ? "Choose a type to approve" : `Approve as ${joinNames(chosen)}`}</span>
            </DialogTrigger>
            <DialogContent title={`Approve ${name}?`}>
              <form action={approve} className="rec-stack">
                <input type="hidden" name="userId" value={userId} />
                {chosen.map((key) => (
                  <input key={key} type="hidden" name="accountRole" value={key} />
                ))}
                <DialogDescription className="body">
                  {name} will be able to sign in and work as <strong>{joinNames(chosen)}</strong>. They get an email saying the account is
                  approved. You can change this later on their page under People.
                </DialogDescription>
                <DialogFooter>
                  <DialogClose className="rec-btn rec-btn--secondary">
                    <span>Cancel</span>
                  </DialogClose>
                  <BusyButton type="submit" variant="primary" busy={approving} busyLabel="Approving…">
                    Yes, approve
                  </BusyButton>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <form action={ask}>
            <input type="hidden" name="userId" value={userId} />
            <BusyButton type="submit" variant="primary" busy={asking} busyLabel="Sending…">
              Ask them to finish the profile
            </BusyButton>
          </form>
        )}

        <Dialog>
          <DialogTrigger className="rec-btn rec-btn--ghost rec-btn--danger-text">
            <span>Reject</span>
          </DialogTrigger>
          <DialogContent title={`Reject ${name}?`}>
            <form action={reject} className="rec-stack">
              <input type="hidden" name="userId" value={userId} />
              <DialogDescription className="body">
                The account is suspended and can no longer sign in. Do this only for sign-ups that do not belong in REC-DMS.
              </DialogDescription>
              <DialogFooter>
                <DialogClose className="rec-btn rec-btn--secondary">
                  <span>Cancel</span>
                </DialogClose>
                <BusyButton type="submit" variant="danger" busy={rejecting} busyLabel="Rejecting…">
                  Yes, reject
                </BusyButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {complete ? null : <p className="body-sm rec-muted">Approve becomes available once the profile is complete.</p>}
    </section>
  );
}
