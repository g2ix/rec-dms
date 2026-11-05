"use client";

import { useActionState, useState } from "react";
import {
  acceptInviteAction,
  inviteMemberAction,
  moveRosterAction,
  removeMemberAction,
  transferLeadershipAction,
} from "@/server/protocols/actions";
import type { ActionState } from "@/server/action-state";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio";
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

export function MembersPanel({
  protocolId,
  members,
  canManage,
  invite,
  emails,
}: {
  protocolId: string;
  members: Row[];
  canManage: boolean;
  invite: Row | null;
  emails: EmailOption[];
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
      {invite ? <AcceptForm protocolId={protocolId} emails={emails} /> : null}
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

function AcceptForm({ protocolId, emails }: { protocolId: string; emails: EmailOption[] }) {
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  const [kind, setKind] = useState<"STUDENT" | "FACULTY">("STUDENT");
  return (
    <form action={action} className="rec-form">
      <h2 className="heading">Accept invitation</h2>
      <p className="body-sm rec-muted">Add the designation that should print on the forms.</p>
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
      <RadioGroup label="Designation">
        <Radio name="kind" value="STUDENT" label="Student" checked={kind === "STUDENT"} onChange={() => setKind("STUDENT")} />
        <Radio name="kind" value="FACULTY" label="Faculty or staff" checked={kind === "FACULTY"} onChange={() => setKind("FACULTY")} />
      </RadioGroup>
      {kind === "STUDENT" ? (
        <>
          <Field label="Course" htmlFor="accept-course">
            <Input id="accept-course" name="course" required />
          </Field>
          <Field label="Year" htmlFor="accept-year">
            <Input id="accept-year" name="yearLabel" required />
          </Field>
        </>
      ) : (
        <>
          <Field label="Position" htmlFor="accept-position">
            <Input id="accept-position" name="position" required />
          </Field>
          <Field label="Unit" htmlFor="accept-unit">
            <Input id="accept-unit" name="unit" required />
          </Field>
        </>
      )}
      <Field label="Institution" htmlFor="accept-institution">
        <Input id="accept-institution" name="institution" required />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Accepting…">
        Accept invitation
      </BusyButton>
    </form>
  );
}
