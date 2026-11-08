"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { z } from "zod";
import { Icon } from "@/components/icons";
import { FundingChoices, ResearchTypeChoices } from "@/components/protocols/study-choices";
import { createProtocolAction } from "@/server/auth/actions";
import type { ActionState } from "@/server/action-state";
import { selectionError } from "@/lib/protocols/catalog";
import { isAllCapsTitle } from "@/lib/protocols/format";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  USC_CAMPUS_ADDRESS,
  USC_INSTITUTION_NAME,
  profileDraftSchema,
  type OrgCatalog,
  type PersonProfileView,
  type ProfileKind,
} from "@/lib/profile";
import { cn } from "@/lib/utils";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormSection } from "@/components/ui/form-section";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type EmailOption = { id: string; email: string; isContact: boolean };
type DisciplineOption = { id: string; name: string; panelName: string };

const USC_KINDS = new Set<ProfileKind>(["USC_STUDENT", "USC_ACADEMIC", "USC_STAFF"]);
const STUDENT_KINDS = new Set<ProfileKind>(["USC_STUDENT", "EXTERNAL_STUDENT"]);

const SECTIONS = [
  { id: "protocol-study", label: "1 · The study" },
  { id: "protocol-place", label: "2 · Where and how big" },
  { id: "protocol-funding", label: "3 · Funding and contact" },
  { id: "protocol-affiliation", label: "4 · Your affiliation" },
] as const;

const SECTION_IDS = SECTIONS.map((section) => section.id);

const FIELD_ORDER = [
  "title",
  "disciplineId",
  "researchType",
  "researchTypeOther",
  "institution",
  "duration",
  "participants",
  "funding",
  "fundingDetail_INSTITUTION",
  "fundingDetail_AGENCY",
  "fundingDetail_OTHER",
  "contactEmailId",
  "kind",
  "academicLevel",
  "position",
  "institutionText",
  "schoolId",
  "departmentId",
  "unitText",
  "programText",
  "yearLabel",
  "officeId",
] as const;

const AFFILIATION_KEYS = new Set<string>([
  "kind",
  "academicLevel",
  "position",
  "institutionText",
  "schoolId",
  "departmentId",
  "unitText",
  "programId",
  "programText",
  "yearLabel",
  "officeId",
]);

const FOCUS_ID: Record<string, string> = {
  title: "protocol-title",
  disciplineId: "protocol-discipline",
  researchType: "protocol-research-type",
  researchTypeOther: "protocol-research-type-other",
  funding: "protocol-funding-kind",
  fundingDetail_INSTITUTION: "protocol-funding-kind-INSTITUTION-detail",
  fundingDetail_AGENCY: "protocol-funding-kind-AGENCY-detail",
  fundingDetail_OTHER: "protocol-funding-kind-OTHER-detail",
  institution: "protocol-institution",
  duration: "protocol-duration",
  participants: "protocol-participants",
  contactEmailId: "protocol-email",
  kind: "protocol-kind",
  academicLevel: "protocol-level",
  position: "protocol-position",
  institutionText: "protocol-institution-text",
  schoolId: "protocol-school",
  departmentId: "protocol-department",
  unitText: "protocol-unit",
  programId: "protocol-program",
  programText: "protocol-program-text",
  yearLabel: "protocol-year",
  officeId: "protocol-office",
};

type AffValues = {
  kind: ProfileKind;
  academicLevel: "" | "UNDERGRADUATE" | "GRADUATE";
  schoolId: string;
  departmentId: string;
  unitText: string;
  officeId: string;
  position: string;
  programId: string;
  programText: string;
  yearLabel: string;
  institutionText: string;
};

function initialAffiliation(profile: PersonProfileView): AffValues {
  return {
    kind: profile.kind,
    academicLevel: profile.academicLevel || "",
    schoolId: profile.schoolId,
    departmentId: profile.departmentId || (!profile.officeId && profile.unitText ? "other" : ""),
    unitText: profile.unitText,
    officeId: profile.officeId,
    position: profile.position,
    programId: profile.programId,
    programText: profile.programText,
    yearLabel: profile.yearLabel,
    institutionText: profile.institutionText,
  };
}

function programsFor(catalog: OrgCatalog, values: AffValues) {
  return catalog.units.filter(
    (unit) =>
      unit.kind === "PROGRAM" &&
      values.departmentId &&
      values.departmentId !== "other" &&
      unit.parentId === values.departmentId &&
      (!values.academicLevel || unit.academicLevel === values.academicLevel),
  );
}

function postedDraft(values: AffValues, uscInstitutionId: string | null, hasPrograms: boolean) {
  const usc = USC_KINDS.has(values.kind);
  const student = STUDENT_KINDS.has(values.kind);
  const unitPosted =
    (usc && values.departmentId === "other") || values.kind === "EXTERNAL_STUDENT" || values.kind === "EXTERNAL_ADVISER"
      ? values.unitText
      : "";
  return {
    kind: values.kind,
    academicLevel: student ? values.academicLevel : "",
    institutionId: usc ? (uscInstitutionId ?? "") : "",
    schoolId: usc ? values.schoolId : "",
    departmentId: usc && values.departmentId && values.departmentId !== "other" ? values.departmentId : "",
    officeId: usc && !student && values.officeId ? values.officeId : "",
    programId: student && hasPrograms ? values.programId : "",
    institutionText: usc ? "" : values.institutionText,
    unitText: unitPosted,
    programText: student ? values.programText : "",
    yearLabel: student ? values.yearLabel : "",
    position: student ? "" : values.position,
  };
}

function collectErrors(input: {
  title: string;
  disciplineId: string;
  researchTypeCodes: readonly string[];
  researchTypeOther: string;
  funding: { code: string; detail: string }[];
  institution: string;
  duration: string;
  participants: string;
  contactEmailId: string;
  aff: AffValues;
  uscInstitutionId: string | null;
  hasPrograms: boolean;
}) {
  const errors: Record<string, string> = {};
  const title = z.string().trim().min(1, "Enter the protocol title.").max(300).safeParse(input.title);
  if (!title.success) errors.title = title.error.issues[0]?.message ?? "Enter the protocol title.";
  const discipline = z.string().uuid("Choose a discipline.").safeParse(input.disciplineId);
  if (!discipline.success) errors.disciplineId = discipline.error.issues[0]?.message ?? "Choose a discipline.";
  const selection = selectionError(input);
  if (selection.researchType) errors.researchType = selection.researchType;
  if (selection.researchTypeOther) errors.researchTypeOther = selection.researchTypeOther;
  if (selection.funding) errors.funding = selection.funding;
  for (const [code, message] of Object.entries(selection.fundingFields)) {
    if (message) errors[`fundingDetail_${code}`] = message;
  }
  if (!input.institution.trim()) errors.institution = "Enter the institution.";
  if (input.duration.trim() && !/^\d+$/.test(input.duration.trim())) errors.duration = "Enter a whole number for duration.";
  if (input.participants.trim() && !/^\d+$/.test(input.participants.trim())) {
    errors.participants = "Enter a whole number for expected participants.";
  }
  const email = z.string().uuid("Choose a contact email.").safeParse(input.contactEmailId);
  if (!email.success) errors.contactEmailId = email.error.issues[0]?.message ?? "Choose a contact email.";
  const affiliation = profileDraftSchema.safeParse(postedDraft(input.aff, input.uscInstitutionId, input.hasPrograms));
  if (!affiliation.success) {
    for (const issue of affiliation.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors[key]) errors[key] = issue.message;
    }
  }
  if (input.aff.departmentId === "other" && errors.departmentId && !errors.unitText) {
    errors.unitText = errors.departmentId;
    delete errors.departmentId;
  }
  return errors;
}

function shown(value: string) {
  const text = value.trim();
  return text || "—";
}

function panelBadge(name: string) {
  const head = name.split(/\s+[—–-]\s+/)[0]?.trim();
  return head || name;
}

function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);
    if (elements.length === 0) return;

    function pick() {
      const marker = 120;
      const nearBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 24;
      if (nearBottom) {
        setActive(elements[elements.length - 1]?.id ?? "");
        return;
      }
      let current = elements[0]?.id ?? "";
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= marker) current = element.id;
      }
      setActive(current);
    }

    const observer = new IntersectionObserver(pick, {
      rootMargin: "-15% 0px -45% 0px",
      threshold: [0, 0.2, 0.5, 1],
    });
    for (const element of elements) observer.observe(element);
    pick();
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

function ProtocolField({
  label,
  htmlFor,
  optional = false,
  help,
  error,
  status,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  help?: string;
  error?: string;
  status?: string;
  className?: string;
  children: (describedBy: string | undefined) => React.ReactNode;
}) {
  const helpId = help ? `${htmlFor}-help` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("rec-field", className, error && "rec-field--error")}>
      <label className="rec-field__label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="rec-field__optional"> (optional)</span> : null}
      </label>
      {children(describedBy)}
      {help ? (
        <p id={helpId} className="caption rec-muted">
          {help}
        </p>
      ) : null}
      {status ? (
        <p className="caption protocol-new__warn" role="status">
          {status}
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
  const [typeCodes, setTypeCodes] = useState<string[]>([]);
  const [typeOther, setTypeOther] = useState("");
  const [fundCodes, setFundCodes] = useState<string[]>([]);
  const [fundDetails, setFundDetails] = useState<Record<string, string>>({});
  const [institution, setInstitution] = useState(profile.institutionName);
  const [duration, setDuration] = useState("");
  const [participants, setParticipants] = useState("");
  const [emailId, setEmailId] = useState(emails[0]?.id ?? "");
  const [aff, setAff] = useState(() => initialAffiliation(profile));
  const [editing, setEditing] = useState(() => {
    const initial = initialAffiliation(profile);
    return !profileDraftSchema.safeParse(
      postedDraft(initial, catalog.uscInstitutionId, programsFor(catalog, initial).length > 0),
    ).success;
  });
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const active = useActiveSection(SECTION_IDS);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const serverError = (state as ActionState)?.error ?? "";

  const usc = USC_KINDS.has(aff.kind);
  const student = STUDENT_KINDS.has(aff.kind);
  const orderedDisciplines = [...disciplines].sort((a, b) => a.name.localeCompare(b.name, "en"));
  const schools = catalog.units.filter(
    (unit) => unit.kind === "SCHOOL" && (!catalog.uscInstitutionId || unit.institutionId === catalog.uscInstitutionId),
  );
  const departments = catalog.units.filter((unit) => unit.kind === "DEPARTMENT" && aff.schoolId && unit.parentId === aff.schoolId);
  const offices = catalog.units.filter(
    (unit) => unit.kind === "OFFICE" && (!aff.schoolId || !unit.parentId || unit.parentId === aff.schoolId || unit.parentId === aff.departmentId),
  );
  const programs = programsFor(catalog, aff);
  const hasPrograms = programs.length > 0;
  const funding = fundCodes.map((code) => ({ code, detail: fundDetails[code] ?? "" }));
  const errors = collectErrors({
    title,
    disciplineId,
    researchTypeCodes: typeCodes,
    researchTypeOther: typeOther,
    funding,
    institution,
    duration,
    participants,
    contactEmailId: emailId,
    aff,
    uscInstitutionId: catalog.uscInstitutionId,
    hasPrograms,
  });
  const visible = (key: string) => ((submitted || touched.has(key)) && errors[key]) || undefined;
  const selected = orderedDisciplines.find((item) => item.id === disciplineId);
  const covered = orderedDisciplines.filter((item) => item.panelName === selected?.panelName).map((item) => item.name);
  const schoolName = catalog.units.find((unit) => unit.id === aff.schoolId && unit.kind === "SCHOOL")?.name ?? "";
  const departmentName =
    aff.departmentId === "other"
      ? aff.unitText
      : (catalog.units.find((unit) => unit.id === aff.departmentId)?.name ?? (!usc ? aff.unitText : ""));
  const facts = [
    { label: "Affiliation", value: PROFILE_KIND_LABELS[aff.kind] },
    { label: "Rank or position", value: student ? "" : aff.position },
    { label: "School", value: schoolName },
    { label: "Department", value: departmentName },
  ];

  useEffect(() => {
    if (!focusKey) return;
    const node = document.getElementById(FOCUS_ID[focusKey] ?? "");
    if (!node) return;
    setFocusKey(null);
    node.scrollIntoView({ block: "center" });
    node.focus();
  }, [focusKey, editing]);

  useEffect(() => {
    if (!serverError) return;
    alertRef.current?.scrollIntoView({ block: "center" });
  }, [serverError]);

  function touch(key: string) {
    setTouched((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }

  function patchAff(partial: Partial<AffValues>) {
    setAff((current) => ({ ...current, ...partial }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    setSubmitted(true);
    const next = collectErrors({
      title,
      disciplineId,
      researchTypeCodes: typeCodes,
      researchTypeOther: typeOther,
      funding: fundCodes.map((code) => ({ code, detail: fundDetails[code] ?? "" })),
      institution,
      duration,
      participants,
      contactEmailId: emailId,
      aff,
      uscInstitutionId: catalog.uscInstitutionId,
      hasPrograms,
    });
    const first = FIELD_ORDER.find((key) => next[key]);
    if (!first) return;
    event.preventDefault();
    if (AFFILIATION_KEYS.has(first)) setEditing(true);
    setFocusKey(first);
  }

  return (
    <div className="protocol-new__layout">
      <form className="protocol-new__form" action={action} noValidate onSubmit={onSubmit}>
        {serverError ? (
          <p ref={alertRef} className="rec-alert" role="alert">
            {serverError}
          </p>
        ) : null}

        <FormSection
          id="protocol-study"
          headingId="protocol-study-heading"
          number="1"
          title="The study"
          description="What you are studying and how the REC should route it."
        >
          <ProtocolField
            label="Protocol title"
            htmlFor="protocol-title"
            help="Write it in sentence or title case, not all capitals."
            error={visible("title")}
            status={isAllCapsTitle(title) ? "This title is in all capitals. The REC asks for sentence case." : undefined}
          >
            {(describedBy) => (
              <Textarea
                id="protocol-title"
                name="title"
                className="protocol-new__title"
                rows={2}
                value={title}
                aria-describedby={describedBy}
                aria-invalid={visible("title") ? true : undefined}
                onBlur={() => touch("title")}
                onChange={(event) => setTitle(event.target.value)}
              />
            )}
          </ProtocolField>
          <ResearchTypeChoices
            id="protocol-research-type"
            selected={typeCodes}
            other={typeOther}
            error={submitted ? errors.researchType : undefined}
            otherError={submitted || touched.has("researchTypeOther") ? errors.researchTypeOther : undefined}
            onOtherBlur={() => touch("researchTypeOther")}
            onToggle={(code, checked) =>
              setTypeCodes((current) => (checked ? [...current, code] : current.filter((item) => item !== code)))
            }
            onOther={setTypeOther}
          />
          <ProtocolField
            label="Discipline"
            htmlFor="protocol-discipline"
            help="This suggests the review panel. REC Staff or the Chair can change that panel."
            error={visible("disciplineId")}
          >
            {(describedBy) => (
              <select
                id="protocol-discipline"
                name="disciplineId"
                className="rec-select"
                value={disciplineId}
                aria-describedby={describedBy}
                aria-invalid={visible("disciplineId") ? true : undefined}
                onBlur={() => touch("disciplineId")}
                onChange={(event) => setDisciplineId(event.target.value)}
              >
                {orderedDisciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.name}
                  </option>
                ))}
              </select>
            )}
          </ProtocolField>
          <div className="protocol-new__panel protocol-new__panel--nested" role="status">
            {selected ? (
              <>
                <span className="rec-badge rec-badge--info">{panelBadge(selected.panelName)}</span>
                <span className="body-sm protocol-new__covered">{covered.join(", ")}</span>
                <p className="caption rec-muted protocol-new__panel-note">
                  · Suggested from your discipline. REC Staff or the Chair may reassign it.
                </p>
              </>
            ) : (
              <span className="body-sm">No panel is mapped yet</span>
            )}
          </div>
        </FormSection>

        <FormSection
          id="protocol-place"
          headingId="protocol-place-heading"
          number="2"
          title="Where and how big"
          description="Where the data comes from and how many people take part."
        >
          <div className="protocol-new__row">
            <ProtocolField label="Study site" htmlFor="protocol-site" optional className="protocol-new__site">
              {(describedBy) => <Input id="protocol-site" name="studySite" aria-describedby={describedBy} />}
            </ProtocolField>
            <ProtocolField label="Duration" htmlFor="protocol-duration" optional className="protocol-new__duration" error={visible("duration")}>
              {(describedBy) => (
                <div className="protocol-new__affix">
                  <Input
                    id="protocol-duration"
                    name="durationMonths"
                    inputMode="numeric"
                    value={duration}
                    aria-describedby={describedBy}
                    aria-invalid={visible("duration") ? true : undefined}
                    onBlur={() => touch("duration")}
                    onChange={(event) => setDuration(event.target.value)}
                  />
                  <span className="protocol-new__suffix">months</span>
                </div>
              )}
            </ProtocolField>
            <ProtocolField
              label="Participants"
              htmlFor="protocol-participants"
              optional
              className="protocol-new__count"
              error={visible("participants")}
            >
              {(describedBy) => (
                <div className="protocol-new__affix">
                  <Input
                    id="protocol-participants"
                    name="expectedParticipants"
                    inputMode="numeric"
                    value={participants}
                    aria-describedby={describedBy}
                    aria-invalid={visible("participants") ? true : undefined}
                    onBlur={() => touch("participants")}
                    onChange={(event) => setParticipants(event.target.value)}
                  />
                  <span className="protocol-new__suffix">people</span>
                </div>
              )}
            </ProtocolField>
          </div>
        </FormSection>

        <FormSection
          id="protocol-funding"
          headingId="protocol-funding-heading"
          number="3"
          title="Funding and contact"
          description="Who pays for the study and how the REC reaches you."
        >
          <FundingChoices
            id="protocol-funding-kind"
            selected={fundCodes}
            details={fundDetails}
            error={visible("funding")}
            fieldError={(code) => visible(`fundingDetail_${code}`)}
            onDetailBlur={(code) => touch(`fundingDetail_${code}`)}
            onToggle={(code, checked) =>
              setFundCodes((current) => (checked ? [...current, code] : current.filter((item) => item !== code)))
            }
            onDetail={(code, value) => setFundDetails((current) => ({ ...current, [code]: value }))}
          />
          <hr className="protocol-new__rule" />
          <div className="protocol-new__row">
            <ProtocolField
              label="Contact email"
              htmlFor="protocol-email"
              className="protocol-new__equal"
              help="Your account email. REC notices for this protocol go here."
              error={visible("contactEmailId")}
            >
              {(describedBy) => (
                <select
                  id="protocol-email"
                  name="contactEmailId"
                  className="rec-select"
                  value={emailId}
                  aria-describedby={describedBy}
                  aria-invalid={visible("contactEmailId") ? true : undefined}
                  onBlur={() => touch("contactEmailId")}
                  onChange={(event) => setEmailId(event.target.value)}
                >
                  {emails.map((email) => (
                    <option key={email.id} value={email.id}>
                      {email.email}
                    </option>
                  ))}
                </select>
              )}
            </ProtocolField>
            <ProtocolField label="Contact number" htmlFor="protocol-phone" optional className="protocol-new__equal">
              {(describedBy) => (
                <Input id="protocol-phone" name="contactNumber" type="tel" autoComplete="tel" aria-describedby={describedBy} />
              )}
            </ProtocolField>
          </div>
        </FormSection>

        <FormSection
          id="protocol-affiliation"
          headingId="protocol-affiliation-heading"
          number="4"
          title="Your affiliation"
          description="How you are identified on this protocol's forms."
        >
          <div className="protocol-new__row">
            <ProtocolField
              label="Institution"
              htmlFor="protocol-institution"
              className="protocol-new__equal"
              help="From your account. Change it if this application uses a different institution."
              error={visible("institution")}
            >
              {(describedBy) => (
                <Input
                  id="protocol-institution"
                  name="institution"
                  value={institution}
                  aria-describedby={describedBy}
                  aria-invalid={visible("institution") ? true : undefined}
                  onBlur={() => touch("institution")}
                  onChange={(event) => setInstitution(event.target.value)}
                />
              )}
            </ProtocolField>
            <ProtocolField
              label="Institution address"
              htmlFor="protocol-address"
              optional
              className="protocol-new__equal"
              help="From your USC account when that is your institution. Change it for this application if you need to."
            >
              {(describedBy) => (
                <Input
                  id="protocol-address"
                  name="institutionAddress"
                  defaultValue={profile.institutionName === USC_INSTITUTION_NAME ? USC_CAMPUS_ADDRESS : ""}
                  aria-describedby={describedBy}
                />
              )}
            </ProtocolField>
          </div>
          {editing ? null : (
            <div className="protocol-new__summary">
              <dl className="protocol-new__facts">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="caption rec-muted">{fact.label}</dt>
                    <dd className="body-sm">{shown(fact.value)}</dd>
                  </div>
                ))}
              </dl>
              <Button
                type="button"
                variant="secondary"
                aria-expanded={false}
                aria-controls="protocol-affiliation-fields"
                onClick={() => {
                  setEditing(true);
                  setFocusKey("kind");
                }}
              >
                Change for this protocol
              </Button>
            </div>
          )}
          <div id="protocol-affiliation-fields" hidden={!editing} className={editing ? "protocol-new__grid" : undefined}>
            <ProtocolField label="Affiliation" htmlFor="protocol-kind" error={visible("kind")}>
              {(describedBy) => (
                <select
                  id="protocol-kind"
                  name="profileKind"
                  className="rec-select"
                  value={aff.kind}
                  aria-describedby={describedBy}
                  aria-invalid={visible("kind") ? true : undefined}
                  onBlur={() => touch("kind")}
                  onChange={(event) => patchAff({ kind: event.target.value as ProfileKind })}
                >
                  {PROFILE_KINDS.map((item) => (
                    <option key={item} value={item}>
                      {PROFILE_KIND_LABELS[item]}
                    </option>
                  ))}
                </select>
              )}
            </ProtocolField>
            {student ? (
              <ProtocolField label="Level" htmlFor="protocol-level" error={visible("academicLevel")}>
                {(describedBy) => (
                  <select
                    id="protocol-level"
                    name="academicLevel"
                    className="rec-select"
                    value={aff.academicLevel}
                    aria-describedby={describedBy}
                    aria-invalid={visible("academicLevel") ? true : undefined}
                    onBlur={() => touch("academicLevel")}
                    onChange={(event) =>
                      patchAff({ academicLevel: event.target.value as AffValues["academicLevel"], programId: "" })
                    }
                  >
                    <option value="">Choose a level</option>
                    <option value="UNDERGRADUATE">Undergraduate</option>
                    <option value="GRADUATE">Graduate</option>
                  </select>
                )}
              </ProtocolField>
            ) : (
              <ProtocolField label="Rank or position" htmlFor="protocol-position" error={visible("position")}>
                {(describedBy) => (
                  <Input
                    id="protocol-position"
                    name="position"
                    value={aff.position}
                    aria-describedby={describedBy}
                    aria-invalid={visible("position") ? true : undefined}
                    onBlur={() => touch("position")}
                    onChange={(event) => patchAff({ position: event.target.value })}
                  />
                )}
              </ProtocolField>
            )}
            {usc ? (
              <ProtocolField
                label="School"
                htmlFor="protocol-school"
                optional={aff.kind === "USC_STAFF"}
                error={visible("schoolId")}
              >
                {(describedBy) => (
                  <select
                    id="protocol-school"
                    name="schoolId"
                    className="rec-select"
                    value={aff.schoolId}
                    aria-describedby={describedBy}
                    aria-invalid={visible("schoolId") ? true : undefined}
                    onBlur={() => touch("schoolId")}
                    onChange={(event) => patchAff({ schoolId: event.target.value, departmentId: "", officeId: "", programId: "" })}
                  >
                    <option value="">{aff.kind === "USC_STAFF" ? "No school" : "Choose a school"}</option>
                    {schools.map((school) => (
                      <option key={school.id} value={school.id}>
                        {school.name}
                      </option>
                    ))}
                  </select>
                )}
              </ProtocolField>
            ) : (
              <ProtocolField
                label={aff.kind === "INDUSTRY_PARTNER" ? "Organization" : "Institution"}
                htmlFor="protocol-institution-text"
                error={visible("institutionText")}
              >
                {(describedBy) => (
                  <Input
                    id="protocol-institution-text"
                    name="institutionText"
                    value={aff.institutionText}
                    aria-describedby={describedBy}
                    aria-invalid={visible("institutionText") ? true : undefined}
                    onBlur={() => touch("institutionText")}
                    onChange={(event) => patchAff({ institutionText: event.target.value })}
                  />
                )}
              </ProtocolField>
            )}
            {usc ? (
              <ProtocolField
                label="Department"
                htmlFor="protocol-department"
                optional={aff.kind !== "USC_STUDENT"}
                error={visible("departmentId")}
              >
                {(describedBy) => (
                  <select
                    id="protocol-department"
                    name={aff.departmentId && aff.departmentId !== "other" ? "departmentId" : undefined}
                    className="rec-select"
                    value={aff.departmentId}
                    aria-describedby={describedBy}
                    aria-invalid={visible("departmentId") ? true : undefined}
                    onBlur={() => touch("departmentId")}
                    onChange={(event) => patchAff({ departmentId: event.target.value, programId: "" })}
                  >
                    <option value="">{aff.kind === "USC_STUDENT" ? "Choose a department" : "No department"}</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                    <option value="other">Not listed</option>
                  </select>
                )}
              </ProtocolField>
            ) : null}
            {usc && aff.departmentId === "other" ? (
              <ProtocolField label="Department or unit" htmlFor="protocol-unit" error={visible("unitText")}>
                {(describedBy) => (
                  <Input
                    id="protocol-unit"
                    name="unitText"
                    value={aff.unitText}
                    aria-describedby={describedBy}
                    aria-invalid={visible("unitText") ? true : undefined}
                    onBlur={() => touch("unitText")}
                    onChange={(event) => patchAff({ unitText: event.target.value })}
                  />
                )}
              </ProtocolField>
            ) : null}
            {!usc && aff.kind === "EXTERNAL_STUDENT" ? (
              <ProtocolField label="Department" htmlFor="protocol-unit" optional error={visible("unitText")}>
                {(describedBy) => (
                  <Input
                    id="protocol-unit"
                    name="unitText"
                    value={aff.unitText}
                    aria-describedby={describedBy}
                    aria-invalid={visible("unitText") ? true : undefined}
                    onBlur={() => touch("unitText")}
                    onChange={(event) => patchAff({ unitText: event.target.value })}
                  />
                )}
              </ProtocolField>
            ) : null}
            {!usc && aff.kind === "EXTERNAL_ADVISER" ? (
              <ProtocolField label="Unit" htmlFor="protocol-unit" error={visible("unitText")}>
                {(describedBy) => (
                  <Input
                    id="protocol-unit"
                    name="unitText"
                    value={aff.unitText}
                    aria-describedby={describedBy}
                    aria-invalid={visible("unitText") ? true : undefined}
                    onBlur={() => touch("unitText")}
                    onChange={(event) => patchAff({ unitText: event.target.value })}
                  />
                )}
              </ProtocolField>
            ) : null}
            {student && hasPrograms ? (
              <ProtocolField label="Listed program" htmlFor="protocol-program" optional>
                {(describedBy) => (
                  <select
                    id="protocol-program"
                    name="programId"
                    className="rec-select"
                    value={aff.programId}
                    aria-describedby={describedBy}
                    onChange={(event) => patchAff({ programId: event.target.value })}
                  >
                    <option value="">Type a program below</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name}
                      </option>
                    ))}
                  </select>
                )}
              </ProtocolField>
            ) : null}
            {student ? (
              <ProtocolField
                label="Program"
                htmlFor="protocol-program-text"
                help="As it should print, for example BS Biology."
                error={visible("programText")}
              >
                {(describedBy) => (
                  <Input
                    id="protocol-program-text"
                    name="programText"
                    value={aff.programText}
                    aria-describedby={describedBy}
                    aria-invalid={visible("programText") ? true : undefined}
                    onBlur={() => touch("programText")}
                    onChange={(event) => patchAff({ programText: event.target.value })}
                  />
                )}
              </ProtocolField>
            ) : null}
            {student ? (
              <ProtocolField label="Year" htmlFor="protocol-year" help="As it should print, for example 3rd year." error={visible("yearLabel")}>
                {(describedBy) => (
                  <Input
                    id="protocol-year"
                    name="yearLabel"
                    value={aff.yearLabel}
                    aria-describedby={describedBy}
                    aria-invalid={visible("yearLabel") ? true : undefined}
                    onBlur={() => touch("yearLabel")}
                    onChange={(event) => patchAff({ yearLabel: event.target.value })}
                  />
                )}
              </ProtocolField>
            ) : null}
            {usc && !student ? (
              <ProtocolField label="Office" htmlFor="protocol-office" optional>
                {(describedBy) => (
                  <select
                    id="protocol-office"
                    name={aff.officeId ? "officeId" : undefined}
                    className="rec-select"
                    value={aff.officeId}
                    aria-describedby={describedBy}
                    onChange={(event) => patchAff({ officeId: event.target.value })}
                  >
                    <option value="">No office</option>
                    {offices.map((office) => (
                      <option key={office.id} value={office.id}>
                        {office.name}
                      </option>
                    ))}
                  </select>
                )}
              </ProtocolField>
            ) : null}
            {usc && catalog.uscInstitutionId ? <input type="hidden" name="institutionId" value={catalog.uscInstitutionId} /> : null}
          </div>
          {editing ? <Checkbox name="saveToProfile" value="yes" label="Save these affiliation details to my profile" /> : null}
          <p className="caption rec-muted protocol-new__note">
            Copied from your details. Changing it here affects only this protocol, unless you choose to save it to your profile too.
          </p>
        </FormSection>

        <div className="protocol-new__foot">
          <p className="caption rec-muted">This creates a draft. Nothing is sent to the REC until you submit.</p>
          <div className="protocol-new__actions">
            <Link className="rec-btn rec-btn--secondary" href="/app/protocols">
              <span>Cancel</span>
            </Link>
            <BusyButton type="submit" variant="primary" busy={pending}>
              Create draft
            </BusyButton>
          </div>
        </div>
      </form>

      <aside className="protocol-new__aside">
        <nav className="protocol-new__nav" aria-label="On this page">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} aria-current={active === section.id ? "location" : undefined}>
              {section.label}
            </a>
          ))}
        </nav>
        <section className="protocol-new__next" aria-labelledby="protocol-next-heading">
          <h2 id="protocol-next-heading" className="subheading">
            After you create it
          </h2>
          <ol>
            <li>Add co-proponents and your adviser</li>
            <li>Upload your proposal and instruments</li>
            <li>Fill in and sign the REC forms</li>
            <li>Submit for screening</li>
          </ol>
        </section>
      </aside>
    </div>
  );
}
