"use client";

import { useActionState, useState } from "react";
import { updateDetailsAction } from "@/server/protocols/actions";
import type { ActionState } from "@/server/action-state";
import { formatBoundValue } from "@/lib/forms/bindings";
import { isAllCapsTitle } from "@/lib/protocols/format";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function DetailsForm({
  protocolId,
  locked,
  values,
  researchers,
}: {
  protocolId: string;
  locked: boolean;
  values: {
    title: string;
    institution: string;
    institutionAddress: string;
    researchType: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    funding: string[];
  };
  researchers: string[];
}) {
  const [state, action, pending] = useActionState(updateDetailsAction, null);
  const [title, setTitle] = useState(values.title);
  const [funds, setFunds] = useState(values.funding.length > 0 ? values.funding : [""]);
  return (
    <div className="rec-stack">
      <section className="rec-card rec-stack">
        <h2 className="heading">Shown on every form</h2>
        <p className="body-sm rec-muted">Researchers follow the proponent roster, in order, as First M. Family.</p>
        <p className="body">{researchers.length > 0 ? researchers.join(", ") : "No active proponents yet."}</p>
      </section>
      <form action={action} className="rec-form">
        {(state as ActionState)?.error ? (
          <p className="rec-alert" role="alert">
            {(state as ActionState)?.error}
          </p>
        ) : null}
        <input type="hidden" name="protocolId" value={protocolId} />
        <Field label="Title" htmlFor="details-title" help="The REC asks that titles not be written in all capitals.">
          <Input id="details-title" name="title" required value={title} onChange={(event) => setTitle(event.target.value)} disabled={locked} />
        </Field>
        {isAllCapsTitle(title) ? (
          <p className="rec-alert" role="status">
            This title is in all capitals. The REC asks for sentence case.
          </p>
        ) : null}
        <Field label="Institution" htmlFor="details-institution">
          <Input id="details-institution" name="institution" required defaultValue={values.institution} disabled={locked} />
        </Field>
        <Field label="Institution address" htmlFor="details-address" optional>
          <Input id="details-address" name="institutionAddress" defaultValue={values.institutionAddress} disabled={locked} />
        </Field>
        <Field label="Research type" htmlFor="details-type">
          <Input id="details-type" name="researchType" required defaultValue={values.researchType} disabled={locked} />
        </Field>
        <Field label="Duration in months" htmlFor="details-duration" optional>
          <Input id="details-duration" name="durationMonths" inputMode="numeric" defaultValue={values.durationMonths ?? ""} disabled={locked} />
        </Field>
        <Field label="Expected participants" htmlFor="details-participants" optional>
          <Input
            id="details-participants"
            name="expectedParticipants"
            inputMode="numeric"
            defaultValue={values.expectedParticipants ?? ""}
            disabled={locked}
          />
        </Field>
        <Field label="Study site" htmlFor="details-site" optional>
          <Input id="details-site" name="studySite" defaultValue={values.studySite} disabled={locked} />
        </Field>
        <fieldset className="rec-stack" disabled={locked}>
          <legend className="label">Source of funds</legend>
          {funds.map((fund, index) => (
            <Field key={index} label={`Source ${index + 1}`} htmlFor={`details-funding-${index}`} optional>
              <Input
                id={`details-funding-${index}`}
                name="funding"
                defaultValue={fund}
                onChange={(event) => setFunds((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
              />
            </Field>
          ))}
          {locked ? null : (
            <Button type="button" onClick={() => setFunds((current) => [...current, ""])}>
              Add a funding source
            </Button>
          )}
        </fieldset>
        {locked ? <p className="body-sm">This version is submitted. Start a revision to edit these details.</p> : null}
        {locked ? null : (
          <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…">
            Save shared details
          </BusyButton>
        )}
        <p className="caption rec-muted">Bound title on forms: {formatBoundValue(title)}</p>
      </form>
    </div>
  );
}
