"use client";

import { useActionState, useMemo, useState } from "react";
import { ProfileFields } from "@/components/account/profile-fields";
import { createProtocolAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { isAllCapsTitle } from "@/lib/protocols/format";
import type { OrgCatalog, PersonProfileView } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { BusyButton } from "@/components/ui/busy-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type EmailOption = { id: string; email: string; isContact: boolean };
type DisciplineOption = { id: string; name: string; panelName: string };

export function ProtocolWizard({
  emails,
  disciplines,
  profile,
  catalog,
}: {
  emails: EmailOption[];
  disciplines: DisciplineOption[];
  profile: PersonProfileView;
  catalog: OrgCatalog;
}) {
  const [state, action, pending] = useActionState(createProtocolAction, null);
  const [title, setTitle] = useState("");
  const [disciplineId, setDisciplineId] = useState(disciplines[0]?.id ?? "");
  const [funds, setFunds] = useState<string[]>([""]);
  const error = (state as ActionState)?.error;
  const panelName = useMemo(
    () => disciplines.find((item) => item.id === disciplineId)?.panelName ?? "No panel is mapped yet",
    [disciplines, disciplineId],
  );
  const caps = isAllCapsTitle(title);

  return (
    <form action={action} className="rec-form">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <Field label="Protocol title" htmlFor="protocol-title" help="The REC asks that titles not be written in all capitals.">
        <Input id="protocol-title" name="title" required value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      {caps ? (
        <p className="rec-alert" role="status">
          This title is in all capitals. The REC asks for sentence case.
        </p>
      ) : null}
      <Field label="Discipline" htmlFor="discipline">
        <select
          id="discipline"
          name="disciplineId"
          className="rec-select"
          required
          value={disciplineId}
          onChange={(event) => setDisciplineId(event.target.value)}
        >
          {disciplines.map((discipline) => (
            <option key={discipline.id} value={discipline.id}>
              {discipline.name}
            </option>
          ))}
        </select>
      </Field>
      <p className="body-sm">
        Suggested panel: <strong>{panelName}</strong>. REC Staff or the Chair can change it.
      </p>
      <Field label="Research type" htmlFor="research-type">
        <Input id="research-type" name="researchType" required />
      </Field>
      <Field label="Institution" htmlFor="institution">
        <Input id="institution" name="institution" defaultValue={profile.institutionName} required />
      </Field>
      <Field label="Institution address" htmlFor="institution-address" optional>
        <Input id="institution-address" name="institutionAddress" />
      </Field>
      <Field label="Duration in months" htmlFor="duration" optional>
        <Input id="duration" name="durationMonths" inputMode="numeric" />
      </Field>
      <Field label="Expected participants" htmlFor="participants" optional>
        <Input id="participants" name="expectedParticipants" inputMode="numeric" />
      </Field>
      <Field label="Study site" htmlFor="study-site" optional>
        <Input id="study-site" name="studySite" />
      </Field>
      <fieldset className="rec-stack">
        <legend className="label">Source of funds</legend>
        {funds.map((fund, index) => (
          <Field key={index} label={`Source ${index + 1}`} htmlFor={`funding-${index}`} optional>
            <Input
              id={`funding-${index}`}
              name="funding"
              value={fund}
              onChange={(event) => setFunds((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
            />
          </Field>
        ))}
        <Button type="button" onClick={() => setFunds((current) => [...current, ""])}>
          Add a funding source
        </Button>
      </fieldset>
      <Field label="Contact email for this protocol" htmlFor="contact-email">
        <select id="contact-email" name="contactEmailId" className="rec-select" defaultValue={emails[0]?.id} required>
          {emails.map((email) => (
            <option key={email.id} value={email.id}>
              {email.email}
              {email.isContact ? " (account contact)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact number" htmlFor="contact-number" optional>
        <Input id="contact-number" name="contactNumber" inputMode="tel" autoComplete="tel" />
      </Field>
      <ProfileFields catalog={catalog} initial={profile} idPrefix="protocol" includeInstitution={false} />
      <Checkbox name="saveToProfile" value="yes" label="Save these affiliation details to my profile" />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Creating…">
        Create protocol
      </BusyButton>
    </form>
  );
}
