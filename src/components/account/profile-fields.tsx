"use client";

import { useMemo, useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KINDS,
  USC_INSTITUTION_NAME,
  type OrgCatalog,
  type PersonProfileView,
  type ProfileKind,
} from "@/lib/profile";

const USC_KINDS = new Set<ProfileKind>(["USC_STUDENT", "USC_ACADEMIC", "USC_STAFF"]);
const STUDENT_KINDS = new Set<ProfileKind>(["USC_STUDENT", "EXTERNAL_STUDENT"]);

export function ProfileFields({
  catalog,
  initial,
  suggestedKind,
  idPrefix = "affiliation",
  includeInstitution = true,
}: {
  catalog: OrgCatalog;
  initial?: PersonProfileView | null;
  suggestedKind?: ProfileKind | null;
  idPrefix?: string;
  includeInstitution?: boolean;
}) {
  const starting = initial?.kind || suggestedKind || "USC_STUDENT";
  const [kind, setKind] = useState<ProfileKind>(starting);
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? "");
  const [departmentId, setDepartmentId] = useState(
    initial?.departmentId || (!initial?.officeId && initial?.unitText ? "other" : ""),
  );
  const [officeId, setOfficeId] = useState(initial?.officeId ?? "");
  const [level, setLevel] = useState(initial?.academicLevel ?? "");
  const usc = USC_KINDS.has(kind);
  const student = STUDENT_KINDS.has(kind);
  const schools = useMemo(
    () => catalog.units.filter((unit) => unit.kind === "SCHOOL" && (!catalog.uscInstitutionId || unit.institutionId === catalog.uscInstitutionId)),
    [catalog],
  );
  const departments = catalog.units.filter(
    (unit) => unit.kind === "DEPARTMENT" && (!schoolId || unit.parentId === schoolId),
  );
  const offices = catalog.units.filter(
    (unit) => unit.kind === "OFFICE" && (!schoolId || !unit.parentId || unit.parentId === schoolId || unit.parentId === departmentId),
  );
  const programs = catalog.units.filter(
    (unit) => unit.kind === "PROGRAM" && departmentId && departmentId !== "other" && unit.parentId === departmentId && (!level || unit.academicLevel === level),
  );
  const needsSchool = kind === "USC_STUDENT" || kind === "USC_ACADEMIC";
  const needsUnit = kind === "USC_STUDENT" || kind === "USC_ACADEMIC" || kind === "USC_STAFF";
  const positionLabel = kind === "INDUSTRY_PARTNER" ? "Role" : kind === "USC_ACADEMIC" ? "Rank or position" : "Position";
  const institutionLabel = kind === "INDUSTRY_PARTNER" ? "Organization" : "Institution";

  return (
    <>
      <Field label="Affiliation" htmlFor={`${idPrefix}-kind`}>
        <select
          id={`${idPrefix}-kind`}
          name="profileKind"
          className="rec-select"
          value={kind}
          onChange={(event) => setKind(event.target.value as ProfileKind)}
          required
        >
          {PROFILE_KINDS.map((item) => (
            <option key={item} value={item}>
              {PROFILE_KIND_LABELS[item]}
            </option>
          ))}
        </select>
      </Field>
      {student ? (
        <Field label="Level" htmlFor={`${idPrefix}-level`}>
          <select
            id={`${idPrefix}-level`}
            name="academicLevel"
            className="rec-select"
            value={level}
            onChange={(event) => setLevel(event.target.value as "" | "UNDERGRADUATE" | "GRADUATE")}
            required
          >
            <option value="">Choose a level</option>
            <option value="UNDERGRADUATE">Undergraduate</option>
            <option value="GRADUATE">Graduate</option>
          </select>
        </Field>
      ) : null}
      {usc && includeInstitution ? (
        <>
          <Field label="Institution" htmlFor={`${idPrefix}-usc`}>
            <Input id={`${idPrefix}-usc`} value={USC_INSTITUTION_NAME} readOnly />
          </Field>
          {catalog.uscInstitutionId ? <input type="hidden" name="institutionId" value={catalog.uscInstitutionId} /> : null}
        </>
      ) : null}
      {usc && !includeInstitution && catalog.uscInstitutionId ? (
        <input type="hidden" name="institutionId" value={catalog.uscInstitutionId} />
      ) : null}
      {!usc && includeInstitution ? (
        <Field label={institutionLabel} htmlFor={`${idPrefix}-institution`}>
          <Input
            id={`${idPrefix}-institution`}
            name="institutionText"
            defaultValue={initial?.institutionText ?? ""}
            required
          />
        </Field>
      ) : null}
      {needsSchool ? (
        <Field label="School" htmlFor={`${idPrefix}-school`}>
          <select
            id={`${idPrefix}-school`}
            name="schoolId"
            className="rec-select"
            value={schoolId}
            onChange={(event) => {
              setSchoolId(event.target.value);
              setDepartmentId("");
              setOfficeId("");
            }}
            required
          >
            <option value="">Choose a school</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {kind === "USC_STAFF" ? (
        <Field label="School" htmlFor={`${idPrefix}-school`} optional>
          <select
            id={`${idPrefix}-school`}
            name="schoolId"
            className="rec-select"
            value={schoolId}
            onChange={(event) => {
              setSchoolId(event.target.value);
              setDepartmentId("");
              setOfficeId("");
            }}
          >
            <option value="">No school</option>
            {schools.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {needsUnit ? (
        <>
          <Field label="Department" htmlFor={`${idPrefix}-department`} optional={kind !== "USC_STUDENT"}>
            <select
              id={`${idPrefix}-department`}
              name={departmentId && departmentId !== "other" ? "departmentId" : undefined}
              className="rec-select"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              required={kind === "USC_STUDENT"}
            >
              <option value="">{kind === "USC_STUDENT" ? "Choose a department" : "No department"}</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
              <option value="other">Not listed</option>
            </select>
          </Field>
          {departmentId === "other" ? (
            <Field label="Department or unit" htmlFor={`${idPrefix}-unit`}>
              <Input id={`${idPrefix}-unit`} name="unitText" defaultValue={initial?.unitText ?? ""} required />
            </Field>
          ) : null}
          {kind !== "USC_STUDENT" ? (
            <Field label="Office" htmlFor={`${idPrefix}-office`} optional>
              <select
                id={`${idPrefix}-office`}
                name={officeId ? "officeId" : undefined}
                className="rec-select"
                value={officeId}
                onChange={(event) => setOfficeId(event.target.value)}
              >
                <option value="">No office</option>
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>
                    {office.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </>
      ) : null}
      {kind === "EXTERNAL_STUDENT" ? (
        <Field label="Department" htmlFor={`${idPrefix}-external-unit`} optional>
          <Input id={`${idPrefix}-external-unit`} name="unitText" defaultValue={initial?.unitText ?? ""} />
        </Field>
      ) : null}
      {kind === "EXTERNAL_ADVISER" ? (
        <Field label="Unit" htmlFor={`${idPrefix}-adviser-unit`}>
          <Input id={`${idPrefix}-adviser-unit`} name="unitText" defaultValue={initial?.unitText ?? ""} required />
        </Field>
      ) : null}
      {student ? (
        <>
          {programs.length > 0 ? (
            <Field label="Listed program" htmlFor={`${idPrefix}-program`} optional>
              <select id={`${idPrefix}-program`} name="programId" className="rec-select" defaultValue={initial?.programId ?? ""}>
                <option value="">Type a program below</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>
                    {program.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Program" htmlFor={`${idPrefix}-program-text`} help="As it should print, for example BS Biology.">
            <Input id={`${idPrefix}-program-text`} name="programText" defaultValue={initial?.programText ?? ""} required={programs.length === 0} />
          </Field>
          <Field label="Year" htmlFor={`${idPrefix}-year`} help="As it should print, for example 3rd year.">
            <Input id={`${idPrefix}-year`} name="yearLabel" defaultValue={initial?.yearLabel ?? ""} required />
          </Field>
        </>
      ) : null}
      {!student ? (
        <Field label={positionLabel} htmlFor={`${idPrefix}-position`}>
          <Input id={`${idPrefix}-position`} name="position" defaultValue={initial?.position ?? ""} required />
        </Field>
      ) : null}
    </>
  );
}
