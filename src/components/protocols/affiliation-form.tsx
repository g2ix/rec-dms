"use client";

import { useActionState } from "react";
import { ProfileFields } from "@/components/account/profile-fields";
import { createProtocolAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import type { OrgCatalog, PersonProfileView } from "@/lib/profile";
import { BusyButton } from "@/components/ui/busy-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type EmailOption = { id: string; email: string; isContact: boolean };

export function ProtocolAffiliationForm({
  emails,
  profile,
  catalog,
}: {
  emails: EmailOption[];
  profile: PersonProfileView;
  catalog: OrgCatalog;
}) {
  const [state, action, pending] = useActionState(createProtocolAction, null);
  const error = (state as ActionState)?.error;

  return (
    <form action={action} className="rec-form">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <Field label="Protocol title" htmlFor="protocol-title" help="The REC asks that titles not be written in all capitals.">
        <Input id="protocol-title" name="title" required />
      </Field>
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
      <Field label="Institution" htmlFor="institution">
        <Input id="institution" name="institution" defaultValue={profile.institutionName} required />
      </Field>
      <ProfileFields catalog={catalog} initial={profile} idPrefix="create" includeInstitution={false} />
      <Checkbox name="saveToProfile" value="yes" label="Save these affiliation details to my profile" />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Creating…">
        Create protocol
      </BusyButton>
    </form>
  );
}
