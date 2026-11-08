"use client";

import { useActionState, useState } from "react";
import { FundingChoices, ResearchTypeChoices } from "@/components/protocols/study-choices";
import { updateDetailsAction } from "@/server/protocols/actions";
import type { ActionState } from "@/server/action-state";
import { formatBoundValue } from "@/lib/forms/bindings";
import { isAllCapsTitle } from "@/lib/protocols/format";
import { BusyButton } from "@/components/ui/busy-button";
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
    researchTypeCodes: string[];
    researchTypeOther: string;
    legacyResearchType: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    funding: { code: string; detail: string }[];
    legacyFunding: string[];
  };
  researchers: string[];
}) {
  const [state, action, pending] = useActionState(updateDetailsAction, null);
  const [title, setTitle] = useState(values.title);
  const [typeCodes, setTypeCodes] = useState(values.researchTypeCodes);
  const [typeOther, setTypeOther] = useState(values.researchTypeOther);
  const [fundCodes, setFundCodes] = useState(values.funding.map((source) => source.code));
  const [fundDetails, setFundDetails] = useState(() =>
    Object.fromEntries(values.funding.map((source) => [source.code, source.detail])),
  );
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
        <Field label="Institution" htmlFor="details-institution" help="The proponents' institution for this application.">
          <Input id="details-institution" name="institution" required defaultValue={values.institution} disabled={locked} />
        </Field>
        <Field label="Institution address" htmlFor="details-address" optional>
          <Input id="details-address" name="institutionAddress" defaultValue={values.institutionAddress} disabled={locked} />
        </Field>
        <ResearchTypeChoices
          id="details-type"
          selected={typeCodes}
          other={typeOther}
          disabled={locked}
          onToggle={(code, checked) => setTypeCodes((current) => (checked ? [...current, code] : current.filter((item) => item !== code)))}
          onOther={setTypeOther}
        />
        {values.legacyResearchType && values.researchTypeCodes.length === 0 ? (
          <p className="caption rec-muted">Previously saved as {values.legacyResearchType}. Choose the types above to replace it.</p>
        ) : null}
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
        <FundingChoices
          id="details-funding"
          selected={fundCodes}
          details={fundDetails}
          disabled={locked}
          onToggle={(code, checked) => setFundCodes((current) => (checked ? [...current, code] : current.filter((item) => item !== code)))}
          onDetail={(code, value) => setFundDetails((current) => ({ ...current, [code]: value }))}
        />
        {values.legacyFunding.length > 0 ? (
          <p className="caption rec-muted">Previously saved as {values.legacyFunding.join("; ")}. Choose the sources above to replace it.</p>
        ) : null}
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
