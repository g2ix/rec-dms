"use client";

import { cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { Info, Lock, AlertCircle } from "lucide-react";
import { z } from "zod";
import { Icon } from "@/components/icons";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRecFormAffiliation, formatRecFormName } from "@/lib/display-name";
import { SUFFIX_CHOICES, TITLE_CHOICES } from "@/lib/name-parts";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  USC_INSTITUTION_NAME,
  profileDraftSchema,
  type OrgCatalog,
  type PersonProfileView,
  type ProfileKind,
} from "@/lib/profile";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/server/action-state";
import { saveProfileAction } from "@/server/profiles/actions";
import { useActionState } from "react";

const USC_KINDS = new Set<ProfileKind>(["USC_STUDENT", "USC_ACADEMIC", "USC_STAFF"]);
const STUDENT_KINDS = new Set<ProfileKind>(["USC_STUDENT", "EXTERNAL_STUDENT"]);

const namePart = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80)
  .regex(/^[\p{L}][\p{L}\s.'-]*$/u, "Use letters, spaces, apostrophes, or hyphens.");

type NameInitial = {
  title?: string;
  firstName?: string;
  middleName?: string;
  familyName?: string;
  suffix?: string;
  credentials?: string;
};

type DetailsValues = {
  title: string;
  titleOther: string;
  firstName: string;
  middleName: string;
  familyName: string;
  suffix: string;
  suffixOther: string;
  credentials: string;
  kind: ProfileKind;
  institutionText: string;
  schoolId: string;
  departmentId: string;
  unitText: string;
  officeId: string;
  position: string;
  academicLevel: "" | "UNDERGRADUATE" | "GRADUATE";
  programId: string;
  programText: string;
  yearLabel: string;
};

function choiceState(value: string | undefined, choices: readonly string[]) {
  const text = value?.trim() ?? "";
  if (!text) return { choice: "", other: "" };
  if ((choices as readonly string[]).includes(text)) return { choice: text, other: "" };
  return { choice: "other", other: text };
}

function startingValues(name: NameInitial, profile: PersonProfileView | null, suggestedKind?: ProfileKind | null): DetailsValues {
  const title = choiceState(name.title, TITLE_CHOICES);
  const suffix = choiceState(name.suffix, SUFFIX_CHOICES);
  return {
    title: title.choice,
    titleOther: title.other,
    firstName: name.firstName ?? "",
    middleName: name.middleName ?? "",
    familyName: name.familyName ?? "",
    suffix: suffix.choice,
    suffixOther: suffix.other,
    credentials: name.credentials ?? "",
    kind: profile?.kind || suggestedKind || "USC_STUDENT",
    institutionText: profile?.institutionText ?? "",
    schoolId: profile?.schoolId ?? "",
    departmentId: profile?.departmentId || (!profile?.officeId && profile?.unitText ? "other" : ""),
    unitText: profile?.unitText ?? "",
    officeId: profile?.officeId ?? "",
    position: profile?.position ?? "",
    academicLevel: profile?.academicLevel ?? "",
    programId: profile?.programId ?? "",
    programText: profile?.programText ?? "",
    yearLabel: profile?.yearLabel ?? "",
  };
}

function draftFrom(values: DetailsValues, uscInstitutionId: string | null) {
  const usc = USC_KINDS.has(values.kind);
  const student = STUDENT_KINDS.has(values.kind);
  return {
    kind: values.kind,
    academicLevel: student ? values.academicLevel : "",
    institutionId: usc ? (uscInstitutionId ?? "") : "",
    schoolId: usc ? values.schoolId : "",
    departmentId: usc && values.departmentId !== "other" ? values.departmentId : "",
    officeId: usc && !student ? values.officeId : "",
    programId: student ? values.programId : "",
    institutionText: usc ? "" : values.institutionText,
    unitText: values.departmentId === "other" || !usc ? values.unitText : "",
    programText: student ? values.programText : "",
    yearLabel: student ? values.yearLabel : "",
    position: student ? "" : values.position,
  };
}

function collectErrors(values: DetailsValues, uscInstitutionId: string | null): Record<string, string> {
  const errors: Record<string, string> = {};
  const first = namePart.safeParse(values.firstName);
  if (!first.success) errors.firstName = first.error.issues[0]?.message ?? "Enter a name.";
  const family = namePart.safeParse(values.familyName);
  if (!family.success) errors.familyName = family.error.issues[0]?.message ?? "Enter a name.";
  if (values.title === "other" && !values.titleOther.trim()) errors.titleOther = "Enter a title.";
  if (values.suffix === "other" && !values.suffixOther.trim()) errors.suffixOther = "Enter a suffix.";
  const parsed = profileDraftSchema.safeParse(draftFrom(values, uscInstitutionId));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  return errors;
}

function DetailsField({
  label,
  htmlFor,
  optional = false,
  help,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  help?: string;
  error?: string;
  className?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const node = children(describedBy);
  const control =
    isValidElement<{ "aria-invalid"?: boolean }>(node) && (node.type === "select" || node.type === Input)
      ? cloneElement(node, { "aria-invalid": error ? true : undefined })
      : node;
  return (
    <div className={cn("rec-field", className, error && "rec-field--error")}>
      <label className="rec-field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="rec-field__optional"> (optional)</span> : null}
      </label>
      {control}
      {help ? (
        <p id={helpId} className="caption rec-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="rec-field__error" role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function AccountDetailsForm({
  name,
  catalog,
  profile,
  suggestedKind,
}: {
  name: NameInitial;
  catalog: OrgCatalog;
  profile: PersonProfileView | null;
  suggestedKind?: ProfileKind | null;
}) {
  const initial = useMemo(() => startingValues(name, profile, suggestedKind), [name, profile, suggestedKind]);
  const [values, setValues] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [state, action, pending] = useActionState(saveProfileAction, null);
  const wasPending = useRef(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);
  const errors = collectErrors(values, catalog.uscInstitutionId);
  const visible = (key: string) => ((submitted || touched.has(key)) && errors[key]) || undefined;

  useEffect(() => {
    if (pending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    if ((state as ActionState)?.error) return;
    setBaseline(valuesRef.current);
    setJustSaved(true);
  }, [pending, state]);

  useEffect(() => {
    if (!justSaved) return;
    const timer = window.setTimeout(() => setJustSaved(false), 3000);
    return () => window.clearTimeout(timer);
  }, [justSaved]);

  function patch(partial: Partial<DetailsValues>) {
    setJustSaved(false);
    setValues((current) => ({ ...current, ...partial }));
  }

  function touch(key: string) {
    setTouched((current) => new Set(current).add(key));
  }

  function discard() {
    setValues(baseline);
    setTouched(new Set());
    setSubmitted(false);
    setJustSaved(false);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    setSubmitted(true);
    const next = collectErrors(values, catalog.uscInstitutionId);
    const first = Object.keys(next)[0];
    if (!first) return;
    event.preventDefault();
    document.getElementById(`details-${first}`)?.focus();
  }

  const usc = USC_KINDS.has(values.kind);
  const student = STUDENT_KINDS.has(values.kind);
  const kindLabel = PROFILE_KIND_LABELS[values.kind];
  const schools = catalog.units.filter(
    (unit) => unit.kind === "SCHOOL" && (!catalog.uscInstitutionId || unit.institutionId === catalog.uscInstitutionId),
  );
  const departments = catalog.units.filter((unit) => unit.kind === "DEPARTMENT" && values.schoolId && unit.parentId === values.schoolId);
  const offices = catalog.units.filter(
    (unit) => unit.kind === "OFFICE" && (!values.schoolId || !unit.parentId || unit.parentId === values.schoolId || unit.parentId === values.departmentId),
  );
  const programs = catalog.units.filter(
    (unit) =>
      unit.kind === "PROGRAM" &&
      values.departmentId &&
      values.departmentId !== "other" &&
      unit.parentId === values.departmentId &&
      (!values.academicLevel || unit.academicLevel === values.academicLevel),
  );
  const schoolName = schools.find((school) => school.id === values.schoolId)?.name ?? "";
  const departmentName =
    values.departmentId === "other"
      ? values.unitText
      : (departments.find((department) => department.id === values.departmentId)?.name ?? (!usc ? values.unitText : ""));
  const previewName = formatRecFormName(values);
  const previewAffiliation = formatRecFormAffiliation({
    department: departmentName,
    school: usc ? schoolName : "",
    institution: usc ? USC_INSTITUTION_NAME : values.institutionText,
  });
  const status = pending ? "Saving…" : dirty ? "Unsaved changes" : justSaved ? "Saved" : "No unsaved changes";
  const serverError = (state as ActionState)?.error;

  return (
    <div className="details-layout">
      <form action={action} className="details-form" noValidate onSubmit={onSubmit}>
        {serverError ? (
          <p className="rec-alert" role="alert">
            {serverError}
          </p>
        ) : null}
        <section className="details-card" aria-labelledby="details-name-heading">
          <div className="details-card__head">
            <h2 id="details-name-heading" className="heading">
              Name
            </h2>
            <p className="body-sm rec-muted">Enter it as it appears on your university ID.</p>
          </div>
          <div className="details-card__body">
            <div className="details-row">
              <div className="details-fixed">
                <DetailsField label="Title" htmlFor="details-title" optional>
                  {(describedBy) => (
                    <select
                      id="details-title"
                      name="title"
                      className="rec-select"
                      value={values.title}
                      aria-describedby={describedBy}
                      onBlur={() => touch("titleOther")}
                      onChange={(event) => patch({ title: event.target.value })}
                    >
                      <option value="">None</option>
                      {TITLE_CHOICES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                      <option value="other">Other</option>
                    </select>
                  )}
                </DetailsField>
                {values.title === "other" ? (
                  <DetailsField label="Other title" htmlFor="details-titleOther" error={visible("titleOther")}>
                    {(describedBy) => (
                      <Input
                        id="details-titleOther"
                        name="titleOther"
                        value={values.titleOther}
                        aria-describedby={describedBy}
                        onBlur={() => touch("titleOther")}
                        onChange={(event) => patch({ titleOther: event.target.value })}
                      />
                    )}
                  </DetailsField>
                ) : null}
              </div>
              <DetailsField label="First name" htmlFor="details-firstName" className="details-grow" error={visible("firstName")}>
                {(describedBy) => (
                  <Input
                    id="details-firstName"
                    name="firstName"
                    autoComplete="given-name"
                    value={values.firstName}
                    aria-describedby={describedBy}
                    onBlur={() => touch("firstName")}
                    onChange={(event) => patch({ firstName: event.target.value })}
                  />
                )}
              </DetailsField>
            </div>
            <div className="details-row">
              <DetailsField
                label="Middle name"
                htmlFor="details-middleName"
                optional
                className="details-equal"
                help="Forms show only the initial, as in Juan D. Cruz."
              >
                {(describedBy) => (
                  <Input
                    id="details-middleName"
                    name="middleName"
                    autoComplete="additional-name"
                    value={values.middleName}
                    aria-describedby={describedBy}
                    onChange={(event) => patch({ middleName: event.target.value })}
                  />
                )}
              </DetailsField>
              <DetailsField label="Family name" htmlFor="details-familyName" className="details-equal" error={visible("familyName")}>
                {(describedBy) => (
                  <Input
                    id="details-familyName"
                    name="familyName"
                    autoComplete="family-name"
                    value={values.familyName}
                    aria-describedby={describedBy}
                    onBlur={() => touch("familyName")}
                    onChange={(event) => patch({ familyName: event.target.value })}
                  />
                )}
              </DetailsField>
            </div>
            <div className="details-row">
              <div className="details-fixed">
                <DetailsField label="Suffix" htmlFor="details-suffix" optional>
                  {(describedBy) => (
                    <select
                      id="details-suffix"
                      name="suffix"
                      className="rec-select"
                      value={values.suffix}
                      aria-describedby={describedBy}
                      onBlur={() => touch("suffixOther")}
                      onChange={(event) => patch({ suffix: event.target.value })}
                    >
                      <option value="">None</option>
                      {SUFFIX_CHOICES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                      <option value="other">Other</option>
                    </select>
                  )}
                </DetailsField>
                {values.suffix === "other" ? (
                  <DetailsField label="Other suffix" htmlFor="details-suffixOther" error={visible("suffixOther")}>
                    {(describedBy) => (
                      <Input
                        id="details-suffixOther"
                        name="suffixOther"
                        value={values.suffixOther}
                        aria-describedby={describedBy}
                        onBlur={() => touch("suffixOther")}
                        onChange={(event) => patch({ suffixOther: event.target.value })}
                      />
                    )}
                  </DetailsField>
                ) : null}
              </div>
              <DetailsField
                label="Degrees and licenses"
                htmlFor="details-credentials"
                optional
                className="details-grow"
                help="Separate with commas. Printed after your name."
              >
                {(describedBy) => (
                  <Input
                    id="details-credentials"
                    name="credentials"
                    placeholder="PhD, MSIT, CPA"
                    value={values.credentials}
                    aria-describedby={describedBy}
                    onChange={(event) => patch({ credentials: event.target.value })}
                  />
                )}
              </DetailsField>
            </div>
          </div>
        </section>

        <section className="details-card" aria-labelledby="details-affiliation-heading">
          <div className="details-card__head">
            <h2 id="details-affiliation-heading" className="heading">
              Affiliation
            </h2>
            <p className="body-sm rec-muted">Where you do your research and what you do there.</p>
          </div>
          <div className="details-card__body">
            <div className="details-row">
              <DetailsField label="You are" htmlFor="details-kind" className="details-equal">
                {(describedBy) => (
                  <select
                    id="details-kind"
                    name="profileKind"
                    className="rec-select"
                    value={values.kind}
                    aria-describedby={describedBy}
                    onChange={(event) => patch({ kind: event.target.value as ProfileKind })}
                  >
                    {PROFILE_KINDS.map((item) => (
                      <option key={item} value={item}>
                        {PROFILE_KIND_LABELS[item]}
                      </option>
                    ))}
                  </select>
                )}
              </DetailsField>
              {usc ? (
                <DetailsField
                  label="Institution"
                  htmlFor="details-institution"
                  className="details-equal"
                  help={`Set by “${kindLabel}”. Choose Outside USC to change it.`}
                >
                  {(describedBy) => (
                    <div className="details-locked">
                      <Input id="details-institution" value={USC_INSTITUTION_NAME} readOnly aria-describedby={describedBy} />
                      <Icon icon={Lock} size={16} />
                      {catalog.uscInstitutionId ? <input type="hidden" name="institutionId" value={catalog.uscInstitutionId} /> : null}
                    </div>
                  )}
                </DetailsField>
              ) : (
                <DetailsField label="Institution" htmlFor="details-institutionText" className="details-equal" error={visible("institutionText")}>
                  {(describedBy) => (
                    <Input
                      id="details-institutionText"
                      name="institutionText"
                      value={values.institutionText}
                      aria-describedby={describedBy}
                      onBlur={() => touch("institutionText")}
                      onChange={(event) => patch({ institutionText: event.target.value })}
                    />
                  )}
                </DetailsField>
              )}
            </div>
            <div className="details-rule" />
            {usc ? (
              <div className="details-row">
                <DetailsField
                  label="School"
                  htmlFor="details-schoolId"
                  optional={values.kind === "USC_STAFF"}
                  className="details-equal"
                  error={visible("schoolId")}
                >
                  {(describedBy) => (
                    <select
                      id="details-schoolId"
                      name="schoolId"
                      className="rec-select"
                      value={values.schoolId}
                      aria-describedby={describedBy}
                      onBlur={() => touch("schoolId")}
                      onChange={(event) => patch({ schoolId: event.target.value, departmentId: "", officeId: "" })}
                    >
                      <option value="">{values.kind === "USC_STAFF" ? "No school" : "Choose a school"}</option>
                      {schools.map((school) => (
                        <option key={school.id} value={school.id}>
                          {school.name}
                        </option>
                      ))}
                    </select>
                  )}
                </DetailsField>
                <DetailsField
                  label="Department"
                  htmlFor="details-departmentId"
                  optional={values.kind !== "USC_STUDENT"}
                  className="details-equal"
                  help="Only departments in the school you chose."
                  error={visible("departmentId")}
                >
                  {(describedBy) => (
                    <select
                      id="details-departmentId"
                      name={values.departmentId && values.departmentId !== "other" ? "departmentId" : undefined}
                      className="rec-select"
                      value={values.departmentId}
                      aria-describedby={describedBy}
                      onBlur={() => touch("departmentId")}
                      onChange={(event) => patch({ departmentId: event.target.value })}
                    >
                      <option value="">{values.kind === "USC_STUDENT" ? "Choose a department" : "No department"}</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                      <option value="other">Not listed</option>
                    </select>
                  )}
                </DetailsField>
              </div>
            ) : null}
            {usc && values.departmentId === "other" ? (
              <DetailsField label="Department or unit" htmlFor="details-unitText" error={visible("unitText")}>
                {(describedBy) => (
                  <Input
                    id="details-unitText"
                    name="unitText"
                    value={values.unitText}
                    aria-describedby={describedBy}
                    onBlur={() => touch("unitText")}
                    onChange={(event) => patch({ unitText: event.target.value })}
                  />
                )}
              </DetailsField>
            ) : null}
            {!usc && values.kind !== "INDUSTRY_PARTNER" ? (
              <DetailsField
                label={values.kind === "EXTERNAL_ADVISER" ? "Unit" : "Department"}
                htmlFor="details-unitText"
                optional={values.kind === "EXTERNAL_STUDENT"}
                error={visible("unitText")}
              >
                {(describedBy) => (
                  <Input
                    id="details-unitText"
                    name="unitText"
                    value={values.unitText}
                    aria-describedby={describedBy}
                    onBlur={() => touch("unitText")}
                    onChange={(event) => patch({ unitText: event.target.value })}
                  />
                )}
              </DetailsField>
            ) : null}
            {student ? (
              <div className="details-row">
                <DetailsField label="Level" htmlFor="details-academicLevel" className="details-equal" error={visible("academicLevel")}>
                  {(describedBy) => (
                    <select
                      id="details-academicLevel"
                      name="academicLevel"
                      className="rec-select"
                      value={values.academicLevel}
                      aria-describedby={describedBy}
                      onBlur={() => touch("academicLevel")}
                      onChange={(event) => patch({ academicLevel: event.target.value as DetailsValues["academicLevel"] })}
                    >
                      <option value="">Choose a level</option>
                      <option value="UNDERGRADUATE">Undergraduate</option>
                      <option value="GRADUATE">Graduate</option>
                    </select>
                  )}
                </DetailsField>
                <DetailsField label="Year" htmlFor="details-yearLabel" className="details-equal" error={visible("yearLabel")}>
                  {(describedBy) => (
                    <Input
                      id="details-yearLabel"
                      name="yearLabel"
                      value={values.yearLabel}
                      aria-describedby={describedBy}
                      onBlur={() => touch("yearLabel")}
                      onChange={(event) => patch({ yearLabel: event.target.value })}
                    />
                  )}
                </DetailsField>
              </div>
            ) : null}
            {student && programs.length > 0 ? (
              <DetailsField label="Listed program" htmlFor="details-programId" optional>
                {(describedBy) => (
                  <select
                    id="details-programId"
                    name="programId"
                    className="rec-select"
                    value={values.programId}
                    aria-describedby={describedBy}
                    onChange={(event) => patch({ programId: event.target.value })}
                  >
                    <option value="">Type a program below</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                )}
              </DetailsField>
            ) : null}
            {student ? (
              <DetailsField label="Program" htmlFor="details-programText" help="As it should print, for example BS Biology." error={visible("programText")}>
                {(describedBy) => (
                  <Input
                    id="details-programText"
                    name="programText"
                    value={values.programText}
                    aria-describedby={describedBy}
                    onBlur={() => touch("programText")}
                    onChange={(event) => patch({ programText: event.target.value })}
                  />
                )}
              </DetailsField>
            ) : null}
            {!student ? (
              <div className="details-row">
                <DetailsField
                  label="Rank or position"
                  htmlFor="details-position"
                  className="details-equal"
                  error={visible("position")}
                >
                  {(describedBy) => (
                    <Input
                      id="details-position"
                      name="position"
                      placeholder="Assistant Professor I"
                      value={values.position}
                      aria-describedby={describedBy}
                      onBlur={() => touch("position")}
                      onChange={(event) => patch({ position: event.target.value })}
                    />
                  )}
                </DetailsField>
                {usc ? (
                  <DetailsField
                    label="Office"
                    htmlFor="details-officeId"
                    optional
                    className="details-equal"
                    help="For staff of a center or administrative office."
                  >
                    {(describedBy) => (
                      <select
                        id="details-officeId"
                        name={values.officeId ? "officeId" : undefined}
                        className="rec-select"
                        value={values.officeId}
                        aria-describedby={describedBy}
                        onChange={(event) => patch({ officeId: event.target.value })}
                      >
                        <option value="">No office</option>
                        {offices.map((office) => (
                          <option key={office.id} value={office.id}>
                            {office.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </DetailsField>
                ) : null}
              </div>
            ) : null}
            <p className="details-note">
              <Icon icon={Info} size={16} />
              <span>Protocols you already submitted keep the affiliation they were sent with. Changes here apply to new protocols.</span>
            </p>
          </div>
        </section>

        <div className="details-savebar">
          <p className={cn("caption rec-muted", justSaved && !dirty && !pending && "details-saved")} aria-live="polite">
            {status}
          </p>
          <div className="details-savebar__actions">
            <Button type="button" variant="secondary" onClick={discard} disabled={!dirty || pending}>
              Discard changes
            </Button>
            <BusyButton type="submit" variant="primary" busy={pending}>
              Save details
            </BusyButton>
          </div>
        </div>
      </form>

      <aside className="details-preview" aria-labelledby="details-preview-heading">
        <h2 id="details-preview-heading" className="subheading">
          On your REC forms
        </h2>
        <div className="details-plate" data-theme="light">
          <p className="caption rec-muted">Researcher(s)/Proponent(s)</p>
          <p className="details-plate__name">{previewName}</p>
          <div className="details-plate__block">
            <p className="caption rec-muted">Affiliation</p>
            <p className="body-sm">{previewAffiliation}</p>
          </div>
          <div className="details-plate__block">
            <p className="caption rec-muted">Rank or position</p>
            <p className={cn("body-sm", (!values.position.trim() || student) && "rec-muted")}>
              {!student && values.position.trim() ? values.position.trim() : "Not set yet"}
            </p>
          </div>
        </div>
        <p className="caption rec-muted">Updates as you type. Check spelling here before saving.</p>
      </aside>
    </div>
  );
}
