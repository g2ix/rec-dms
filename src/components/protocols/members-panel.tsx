"use client";

import { useActionState } from "react";
import { ProfileForm } from "@/components/account/profile-form";
import { ProfileFields } from "@/components/account/profile-fields";
import {
  acceptInviteAction,
  inviteMemberAction,
  moveRosterAction,
  removeMemberAction,
  transferLeadershipAction,
} from "@/server/protocols/actions";
import type { ActionState } from "@/server/action-state";
import type { OrgCatalog, PersonProfileView, ProfileKind } from "@/lib/profile";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

type EmailOption = { id: string; email: string; isContact: boolean };
type Row = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  designation: string;
  isLeader: boolean;
  rosterOrder: number;
};

type NameInitial = {
  title?: string;
  firstName?: string;
  middleName?: string;
  familyName?: string;
  suffix?: string;
  credentials?: string;
};

export function MembersPanel({
  protocolId,
  members,
  canManage,
  invite,
  emails,
  profile,
  catalog,
  suggestedKind,
  name,
}: {
  protocolId: string;
  members: Row[];
  canManage: boolean;
  invite: Row | null;
  emails: EmailOption[];
  profile: PersonProfileView | null;
  catalog: OrgCatalog;
  suggestedKind: ProfileKind | null;
  name: NameInitial;
}) {
  return (
    <div className="rec-stack">
      <ol className="rec-methods">
        {members.map((member, index) => (
          <li key={member.id} className="rec-card rec-stack">
            <div className="rec-inline">
              <p className="code">{member.rosterOrder}</p>
              <h2 className="heading">{member.name}</h2>
              {member.isLeader ? <StatusBadge tone="success" label="Project leader" /> : null}
              <StatusBadge tone="info" label={member.role === "ADVISER" ? "Adviser" : "Proponent"} />
              {member.status === "INVITED" ? <StatusBadge tone="warning" label="Invited" /> : null}
            </div>
            {member.email && member.email !== member.name ? <p className="body-sm">{member.email}</p> : null}
            {member.designation ? <p className="body-sm rec-muted">{member.designation}</p> : null}
            {canManage && !member.isLeader ? (
              <div className="rec-inline">
                <form action={moveRosterAction}>
                  <input type="hidden" name="protocolId" value={protocolId} />
                  <input type="hidden" name="memberId" value={member.id} />
                  <input type="hidden" name="direction" value="up" />
                  <Button type="submit" disabled={index <= 1}>
                    Move up
                  </Button>
                </form>
                <form action={moveRosterAction}>
                  <input type="hidden" name="protocolId" value={protocolId} />
                  <input type="hidden" name="memberId" value={member.id} />
                  <input type="hidden" name="direction" value="down" />
                  <Button type="submit" disabled={index === members.length - 1}>
                    Move down
                  </Button>
                </form>
                {member.role === "PROPONENT" && member.status === "ACTIVE" ? (
                  <form action={transferLeadershipAction}>
                    <input type="hidden" name="protocolId" value={protocolId} />
                    <input type="hidden" name="memberId" value={member.id} />
                    <Button type="submit">Make project leader</Button>
                  </form>
                ) : null}
                <form action={removeMemberAction}>
                  <input type="hidden" name="protocolId" value={protocolId} />
                  <input type="hidden" name="memberId" value={member.id} />
                  <Button type="submit" variant="danger">
                    Remove
                  </Button>
                </form>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {invite && !profile ? (
        <ProfileForm
          name={name}
          catalog={catalog}
          profile={null}
          suggestedKind={suggestedKind}
          protocolId={protocolId}
          intro="Save your details, then accept the invitation. The designation that prints comes from these details."
        />
      ) : null}
      {invite && profile ? (
        <AcceptForm protocolId={protocolId} emails={emails} profile={profile} catalog={catalog} />
      ) : null}
      {canManage ? <InviteForm protocolId={protocolId} /> : null}
    </div>
  );
}

function InviteForm({ protocolId }: { protocolId: string }) {
  const [state, action, pending] = useActionState(inviteMemberAction, null);
  return (
    <form action={action} className="rec-form">
      <h2 className="heading">Invite</h2>
      {(state as ActionState)?.error ? (
        <p className="rec-alert" role="alert">
          {(state as ActionState)?.error}
        </p>
      ) : null}
      <input type="hidden" name="protocolId" value={protocolId} />
      <Field label="Email" htmlFor="invite-email">
        <Input id="invite-email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Role" htmlFor="invite-role">
        <select id="invite-role" name="role" className="rec-select" defaultValue="PROPONENT">
          <option value="PROPONENT">Proponent</option>
          <option value="ADVISER">Adviser</option>
        </select>
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Sending…">
        Send invitation
      </BusyButton>
    </form>
  );
}

function AcceptForm({
  protocolId,
  emails,
  profile,
  catalog,
}: {
  protocolId: string;
  emails: EmailOption[];
  profile: PersonProfileView;
  catalog: OrgCatalog;
}) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  return (
    <form action={action} className="rec-form">
      <h2 className="heading">Accept invitation</h2>
      <p className="body-sm rec-muted">Confirm the designation that should print on the forms. A correction here stays on this protocol.</p>
      {(state as ActionState)?.error ? (
        <p className="rec-alert" role="alert">
          {(state as ActionState)?.error}
        </p>
      ) : null}
      <input type="hidden" name="protocolId" value={protocolId} />
      <Field label="Contact email" htmlFor="accept-email">
        <select id="accept-email" name="contactEmailId" className="rec-select" required defaultValue={emails[0]?.id}>
          {emails.map((email) => (
            <option key={email.id} value={email.id}>
              {email.email}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Contact number" htmlFor="accept-phone" optional>
        <Input id="accept-phone" name="contactNumber" inputMode="tel" />
      </Field>
      <ProfileFields catalog={catalog} initial={profile} idPrefix="accept" includeInstitution />
      <Checkbox name="saveToProfile" value="yes" label="Save these affiliation details to my profile" />
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Accepting…">
        Accept invitation
      </BusyButton>
    </form>
  );
}
