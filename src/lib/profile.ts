import { z } from "zod";

export const PROFILE_KINDS = [
  "USC_STUDENT",
  "EXTERNAL_STUDENT",
  "USC_ACADEMIC",
  "USC_STAFF",
  "EXTERNAL_ADVISER",
  "INDUSTRY_PARTNER",
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PROFILE_KIND_LABELS: Record<ProfileKind, string> = {
  USC_STUDENT: "USC student",
  EXTERNAL_STUDENT: "Student at another institution",
  USC_ACADEMIC: "USC faculty",
  USC_STAFF: "USC staff",
  EXTERNAL_ADVISER: "Adviser from outside USC",
  INDUSTRY_PARTNER: "Industry partner",
};

export const USC_INSTITUTION_NAME = "University of San Carlos";
export const USC_CAMPUS_ADDRESS = "Nasipit, Talamban, Cebu City";

export type AcademicLevelValue = "UNDERGRADUATE" | "GRADUATE";

export type OrgCatalog = {
  uscInstitutionId: string | null;
  institutions: { id: string; name: string }[];
  units: {
    id: string;
    institutionId: string;
    parentId: string | null;
    kind: "SCHOOL" | "DEPARTMENT" | "OFFICE" | "PROGRAM";
    name: string;
    academicLevel: AcademicLevelValue | null;
  }[];
};

export type PersonProfileView = {
  kind: ProfileKind;
  academicLevel: AcademicLevelValue | "";
  institutionId: string;
  institutionName: string;
  schoolId: string;
  departmentId: string;
  officeId: string;
  programId: string;
  institutionText: string;
  unitText: string;
  programText: string;
  yearLabel: string;
  position: string;
};

const optionalId = z.string().trim().uuid().optional().or(z.literal(""));
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const profileDraftSchema = z
  .object({
    kind: z.enum(PROFILE_KINDS),
    academicLevel: z.enum(["UNDERGRADUATE", "GRADUATE"]).optional().or(z.literal("")),
    institutionId: optionalId,
    schoolId: optionalId,
    departmentId: optionalId,
    officeId: optionalId,
    programId: optionalId,
    institutionText: optionalText(160),
    unitText: optionalText(160),
    programText: optionalText(120),
    yearLabel: optionalText(40),
    position: optionalText(120),
  })
  .superRefine((value, ctx) => {
    const missing = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    const student = value.kind === "USC_STUDENT" || value.kind === "EXTERNAL_STUDENT";
    if (student) {
      if (!value.academicLevel) missing("academicLevel", "Choose undergraduate or graduate.");
      if (!value.yearLabel) missing("yearLabel", "Enter the year.");
      if (!value.programText && !value.programId) missing("programText", "Enter the program.");
    }
    if (value.kind === "USC_STUDENT") {
      if (!value.schoolId) missing("schoolId", "Choose a school.");
      if (!value.departmentId && !value.unitText) missing("departmentId", "Choose a department.");
    }
    if (value.kind === "EXTERNAL_STUDENT" && !value.institutionText && !value.institutionId) {
      missing("institutionText", "Enter the institution.");
    }
    if (value.kind === "USC_ACADEMIC") {
      if (!value.position) missing("position", "Enter the rank or position.");
      if (!value.schoolId) missing("schoolId", "Choose a school.");
      if (!value.departmentId && !value.officeId && !value.unitText) {
        missing("departmentId", "Choose a department or an office.");
      }
    }
    if (value.kind === "USC_STAFF") {
      if (!value.position) missing("position", "Enter the position.");
      if (!value.departmentId && !value.officeId && !value.unitText) {
        missing("departmentId", "Choose a department or an office.");
      }
    }
    if (value.kind === "EXTERNAL_ADVISER") {
      if (!value.position) missing("position", "Enter the position.");
      if (!value.institutionText && !value.institutionId) missing("institutionText", "Enter the institution.");
      if (!value.unitText) missing("unitText", "Enter the unit.");
    }
    if (value.kind === "INDUSTRY_PARTNER") {
      if (!value.position) missing("position", "Enter the role.");
      if (!value.institutionText && !value.institutionId) missing("institutionText", "Enter the organization.");
    }
  });

export type ProfileDraft = z.infer<typeof profileDraftSchema>;

export function profileDraftFromForm(formData: FormData): ProfileDraft {
  return profileDraftSchema.parse({
    kind: formData.get("profileKind"),
    academicLevel: formData.get("academicLevel") ?? "",
    institutionId: formData.get("institutionId") ?? "",
    schoolId: formData.get("schoolId") ?? "",
    departmentId: formData.get("departmentId") ?? "",
    officeId: formData.get("officeId") ?? "",
    programId: formData.get("programId") ?? "",
    institutionText: formData.get("institutionText") ?? "",
    unitText: formData.get("unitText") ?? "",
    programText: formData.get("programText") ?? "",
    yearLabel: formData.get("yearLabel") ?? "",
    position: formData.get("position") ?? "",
  });
}

export function isProfileKind(value: string): value is ProfileKind {
  return (PROFILE_KINDS as readonly string[]).includes(value);
}

/** A digit-only USC address suggests a student. firstname.lastname suggests faculty or staff. */
export function suggestProfileKind(email: string | null | undefined): ProfileKind | null {
  if (!email) return null;
  const [local, host] = email.trim().toLowerCase().split("@");
  if (!local || !host) return null;
  if (host !== "usc.edu.ph" && !host.endsWith(".usc.edu.ph")) return null;
  if (/^\d+$/.test(local)) return "USC_STUDENT";
  if (/^[a-z]+(?:[.-][a-z]+)+$/i.test(local)) return "USC_ACADEMIC";
  return null;
}

export function legacyAffiliationKind(kind: string): "STUDENT" | "FACULTY" {
  if (kind === "STUDENT" || kind === "USC_STUDENT" || kind === "EXTERNAL_STUDENT") return "STUDENT";
  return "FACULTY";
}

export function formatProfileDesignation(input: {
  kind: string;
  programName?: string | null;
  course?: string | null;
  yearLabel?: string | null;
  departmentName?: string | null;
  schoolName?: string | null;
  officeName?: string | null;
  position?: string | null;
  unit?: string | null;
  institution: string;
}): string {
  const program = (input.programName || input.course || "").trim();
  const department = (input.departmentName || "").trim();
  const school = (input.schoolName || "").trim();
  const office = (input.officeName || "").trim();
  const unit = (input.unit || "").trim();
  const year = (input.yearLabel || "").trim();
  const position = (input.position || "").trim();
  const institution = input.institution.trim();
  const kind = input.kind;
  let parts: string[];
  if (kind === "STUDENT" || kind === "USC_STUDENT" || kind === "EXTERNAL_STUDENT") {
    parts = [program, year, department, school, institution];
  } else if (kind === "USC_ACADEMIC") {
    parts = [position, department, office, school, institution];
  } else if (kind === "USC_STAFF") {
    parts = [position, department, office, institution];
  } else if (kind === "INDUSTRY_PARTNER") {
    parts = [position, institution];
  } else {
    parts = [position, unit || department || office, institution];
  }
  return parts.filter(Boolean).join(", ");
}

export type MembershipAffiliation = {
  kind: "STUDENT" | "FACULTY";
  course?: string;
  yearLabel?: string;
  position?: string;
  unit?: string;
  institution: string;
  contactEmailId: string;
  profileKind: ProfileKind;
  academicLevel: AcademicLevelValue | null;
  schoolName: string | null;
  departmentName: string | null;
  officeName: string | null;
  programName: string | null;
  designationText: string;
};

export function toMembershipAffiliation(input: {
  contactEmailId: string;
  kind: ProfileKind;
  institution: string;
  programName?: string | null;
  yearLabel?: string | null;
  position?: string | null;
  departmentName?: string | null;
  schoolName?: string | null;
  officeName?: string | null;
  unitText?: string | null;
  academicLevel?: AcademicLevelValue | null;
}): MembershipAffiliation {
  const legacy = legacyAffiliationKind(input.kind);
  const departmentName = input.departmentName?.trim() || null;
  const schoolName = input.schoolName?.trim() || null;
  const officeName = input.officeName?.trim() || null;
  const programName = input.programName?.trim() || null;
  const unitText = input.unitText?.trim() || null;
  const usesListedUnit =
    input.kind === "USC_STUDENT" ||
    input.kind === "EXTERNAL_STUDENT" ||
    input.kind === "USC_ACADEMIC" ||
    input.kind === "USC_STAFF";
  const resolvedDepartment = departmentName || (usesListedUnit && !officeName ? unitText : null);
  const designationText = formatProfileDesignation({
    kind: input.kind,
    programName,
    yearLabel: input.yearLabel,
    departmentName: resolvedDepartment,
    schoolName,
    officeName,
    position: input.position,
    unit: unitText,
    institution: input.institution,
  });
  const shared = {
    institution: input.institution,
    contactEmailId: input.contactEmailId,
    profileKind: input.kind,
    academicLevel: input.academicLevel ?? null,
    schoolName,
    departmentName: resolvedDepartment,
    officeName,
    programName,
    designationText,
  };
  if (legacy === "STUDENT") {
    return {
      kind: "STUDENT",
      course: programName || "Student",
      yearLabel: input.yearLabel?.trim() || "",
      ...shared,
    };
  }
  const unit = [departmentName, officeName, unitText].filter(Boolean).join(", ");
  return {
    kind: "FACULTY",
    position: input.position?.trim() || "Member",
    unit: unit || input.institution,
    ...shared,
  };
}
