"use client";

import { useActionState, useState } from "react";
import { createProtocolAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { BusyButton } from "@/components/ui/busy-button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Radio, RadioGroup } from "@/components/ui/radio";

type EmailOption = { id: string; email: string; isContact: boolean };
type StudentSuggestion = { course: string; yearLabel: string; institution: string; contactEmailId: string } | null;
type FacultySuggestion = { position: string; unit: string; institution: string; contactEmailId: string } | null;

export function ProtocolAffiliationForm({
  emails,
  student,
  faculty,
}: {
  emails: EmailOption[];
  student: StudentSuggestion;
  faculty: FacultySuggestion;
}) {
  const [state, action, pending] = useActionState(createProtocolAction, null);
  const [kind, setKind] = useState<"STUDENT" | "FACULTY">(student && !faculty ? "STUDENT" : faculty && !student ? "FACULTY" : "STUDENT");
  const suggestion = kind === "STUDENT" ? student : faculty;
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
        <select
          key={kind}
          id="contact-email"
          name="contactEmailId"
          className="rec-select"
          defaultValue={suggestion?.contactEmailId ?? emails[0]?.id}
          required
        >
          {emails.map((email) => (
            <option key={email.id} value={email.id}>
              {email.email}
              {email.isContact ? " (account contact)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <RadioGroup label="Designation on this protocol">
        <Radio name="kind" value="STUDENT" label="Student" checked={kind === "STUDENT"} onChange={() => setKind("STUDENT")} />
        <Radio name="kind" value="FACULTY" label="Faculty or staff" checked={kind === "FACULTY"} onChange={() => setKind("FACULTY")} />
      </RadioGroup>
      {kind === "STUDENT" ? (
        <>
          <Field key="course" label="Course" htmlFor="course">
            <Input id="course" name="course" defaultValue={student?.course ?? ""} required />
          </Field>
          <Field key="year" label="Year" htmlFor="year-label" help="As it should print, for example 3rd year.">
            <Input id="year-label" name="yearLabel" defaultValue={student?.yearLabel ?? ""} required />
          </Field>
        </>
      ) : (
        <>
          <Field key="position" label="Position" htmlFor="position">
            <Input id="position" name="position" defaultValue={faculty?.position ?? ""} required />
          </Field>
          <Field key="unit" label="Unit" htmlFor="unit">
            <Input id="unit" name="unit" defaultValue={faculty?.unit ?? ""} required />
          </Field>
        </>
      )}
      <Field label="Institution" htmlFor="institution">
        <Input
          key={kind}
          id="institution"
          name="institution"
          defaultValue={kind === "STUDENT" ? (student?.institution ?? "") : (faculty?.institution ?? "")}
          required
        />
      </Field>
      <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Creating…">
        Create protocol
      </BusyButton>
    </form>
  );
}
