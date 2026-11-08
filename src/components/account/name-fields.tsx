"use client";

import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CREDENTIAL_CHOICES, SUFFIX_CHOICES, TITLE_CHOICES } from "@/lib/name-parts";

type NameInitial = {
  title?: string;
  firstName?: string;
  middleName?: string;
  familyName?: string;
  suffix?: string;
  credentials?: string;
};

function choiceState(value: string | undefined, choices: readonly string[]) {
  const text = value?.trim() ?? "";
  if (!text) return { choice: "", other: "" };
  if ((choices as readonly string[]).includes(text)) return { choice: text, other: "" };
  return { choice: "other", other: text };
}

export function NameFields({ initial, idPrefix = "name" }: { initial?: NameInitial; idPrefix?: string }) {
  const title = choiceState(initial?.title, TITLE_CHOICES);
  const suffix = choiceState(initial?.suffix, SUFFIX_CHOICES);
  const [titleChoice, setTitleChoice] = useState(title.choice);
  const [suffixChoice, setSuffixChoice] = useState(suffix.choice);

  return (
    <>
      <Field label="Title" htmlFor={`${idPrefix}-title`} optional>
        <select
          id={`${idPrefix}-title`}
          name="title"
          className="rec-select"
          value={titleChoice}
          onChange={(event) => setTitleChoice(event.target.value)}
        >
          <option value="">None</option>
          {TITLE_CHOICES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
          <option value="other">Other</option>
        </select>
      </Field>
      {titleChoice === "other" ? (
        <Field label="Other title" htmlFor={`${idPrefix}-title-other`}>
          <Input id={`${idPrefix}-title-other`} name="titleOther" defaultValue={title.other} required />
        </Field>
      ) : null}
      <Field label="First name" htmlFor={`${idPrefix}-first`}>
        <Input id={`${idPrefix}-first`} name="firstName" autoComplete="given-name" defaultValue={initial?.firstName ?? ""} required />
      </Field>
      <Field label="Middle name" htmlFor={`${idPrefix}-middle`} optional help="Screens and forms use the first letter, as in Juan D. Cruz.">
        <Input id={`${idPrefix}-middle`} name="middleName" autoComplete="additional-name" defaultValue={initial?.middleName ?? ""} />
      </Field>
      <Field label="Family name" htmlFor={`${idPrefix}-family`}>
        <Input id={`${idPrefix}-family`} name="familyName" autoComplete="family-name" defaultValue={initial?.familyName ?? ""} required />
      </Field>
      <Field label="Suffix" htmlFor={`${idPrefix}-suffix`} optional help="Jr, II, III, and similar.">
        <select
          id={`${idPrefix}-suffix`}
          name="suffix"
          className="rec-select"
          value={suffixChoice}
          onChange={(event) => setSuffixChoice(event.target.value)}
        >
          <option value="">None</option>
          {SUFFIX_CHOICES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
          <option value="other">Other</option>
        </select>
      </Field>
      {suffixChoice === "other" ? (
        <Field label="Other suffix" htmlFor={`${idPrefix}-suffix-other`}>
          <Input id={`${idPrefix}-suffix-other`} name="suffixOther" defaultValue={suffix.other} required />
        </Field>
      ) : null}
      <Field label="Extension" htmlFor={`${idPrefix}-credentials`} optional help={`Degrees and licenses, separated by commas. For example ${CREDENTIAL_CHOICES.slice(0, 4).join(", ")}.`}>
        <Input id={`${idPrefix}-credentials`} name="credentials" defaultValue={initial?.credentials ?? ""} />
      </Field>
    </>
  );
}
