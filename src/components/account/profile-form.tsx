"use client";

import { useActionState } from "react";
import { NameFields } from "@/components/account/name-fields";
import { ProfileFields } from "@/components/account/profile-fields";
import { BusyButton } from "@/components/ui/busy-button";
import type { ActionState } from "@/server/action-state";
import { saveProfileAction } from "@/server/profiles/actions";
import type { OrgCatalog, PersonProfileView, ProfileKind } from "@/lib/profile";

type NameInitial = {
  title?: string;
  firstName?: string;
  middleName?: string;
  familyName?: string;
  suffix?: string;
  credentials?: string;
};

export function ProfileForm({
  name,
  catalog,
  profile,
  suggestedKind,
  protocolId,
  intro,
}: {
  name: NameInitial;
  catalog: OrgCatalog;
  profile: PersonProfileView | null;
  suggestedKind?: ProfileKind | null;
  protocolId?: string;
  intro?: string;
}) {
  const [state, action, pending] = useActionState(saveProfileAction, null);
  const error = (state as ActionState)?.error;
  return (
    <form action={action} className="rec-form">
      {intro ? <p className="body">{intro}</p> : null}
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      {protocolId ? <input type="hidden" name="protocolId" value={protocolId} /> : null}
      <NameFields initial={name} />
      <ProfileFields catalog={catalog} initial={profile} suggestedKind={suggestedKind} includeInstitution />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…">
        Save details
      </BusyButton>
    </form>
  );
}
