import { z } from "zod";
import { FUNDING_KINDS, selectionError } from "@/lib/protocols/catalog";
import { profileDraftSchema, type ProfileDraft } from "@/lib/profile";

/** Section cards on the new-protocol form, in page order. */
export const NEW_PROTOCOL_SECTIONS = [
  {
    key: "study",
    id: "protocol-study",
    headingId: "protocol-study-heading",
    number: "1",
    title: "The study",
    description: "What you are studying and how the REC should route it.",
  },
  {
    key: "where",
    id: "protocol-place",
    headingId: "protocol-place-heading",
    number: "2",
    title: "Where and how big",
    description: "Where the data comes from and how many people take part.",
  },
  {
    key: "contact",
    id: "protocol-funding",
    headingId: "protocol-funding-heading",
    number: "3",
    title: "Funding and contact",
    description: "Who pays for the study and how the REC reaches you.",
  },
  {
    key: "affiliation",
    id: "protocol-affiliation",
    headingId: "protocol-affiliation-heading",
    number: "4",
    title: "Your affiliation",
    description: "How you are identified on this protocol's forms.",
  },
] as const;

export type SectionKey = (typeof NEW_PROTOCOL_SECTIONS)[number]["key"];
export type SectionStatus = "optional" | "not-started" | "in-progress" | "complete";

const HASH_ALIASES: Record<string, (typeof NEW_PROTOCOL_SECTIONS)[number]["id"]> = {
  study: "protocol-study",
  where: "protocol-place",
  place: "protocol-place",
  funding: "protocol-funding",
  contact: "protocol-funding",
  affiliation: "protocol-affiliation",
};

/** Same constraints as the create form. Messages stay in the form; this only asks whether the value passes. */
const titleSchema = z.string().trim().min(1).max(300);
const uuidSchema = z.string().uuid();

/** Affiliation issues are focused in the order the controls appear. */
const AFFILIATION_FOCUS_ORDER = [
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

export type SectionRequirement = {
  id: string;
  focusKey: string;
  met: boolean;
  filled: boolean;
};

export type SectionProgress = {
  key: SectionKey;
  id: string;
  headingId: string;
  number: string;
  title: string;
  description: string;
  status: SectionStatus;
  missing: number;
  /** Unmet requirement ids, in the order a click should focus them. */
  gaps: string[];
  focusKey: string | null;
};

export type SectionProgressInput = {
  title: string;
  disciplineId: string;
  researchTypeCodes: readonly string[];
  researchTypeOther: string;
  funding: { code: string; detail: string }[];
  institution: string;
  contactEmailId: string;
  affiliation: ProfileDraft;
  /** Schema path → form key, when the empty control is not the issue path. */
  affiliationFocus?: Partial<Record<string, string>>;
  touched: Partial<Record<SectionKey, boolean>>;
};

function filled(value: string) {
  return value.trim().length > 0;
}

function statusFor(requirements: SectionRequirement[], touched: boolean, anyFilled: boolean): SectionStatus {
  if (requirements.length === 0) return "optional";
  if (requirements.every((item) => item.met)) return "complete";
  if (!touched && !anyFilled && !requirements.some((item) => item.filled)) return "not-started";
  return "in-progress";
}

function pack(
  section: (typeof NEW_PROTOCOL_SECTIONS)[number],
  requirements: SectionRequirement[],
  touched: boolean,
  anyFilled: boolean,
): SectionProgress {
  const gaps = requirements.filter((item) => !item.met);
  return {
    key: section.key,
    id: section.id,
    headingId: section.headingId,
    number: section.number,
    title: section.title,
    description: section.description,
    status: statusFor(requirements, touched, anyFilled),
    missing: gaps.length,
    gaps: gaps.map((item) => item.id),
    focusKey: gaps[0]?.focusKey ?? null,
  };
}

function studyRequirements(input: SectionProgressInput): SectionRequirement[] {
  const selection = selectionError(input);
  const researchMet = !selection.researchType && !selection.researchTypeOther;
  const focusKey = selection.researchTypeOther && !selection.researchType ? "researchTypeOther" : "researchType";
  return [
    { id: "title", focusKey: "title", met: titleSchema.safeParse(input.title).success, filled: filled(input.title) },
    {
      id: "discipline",
      focusKey: "disciplineId",
      met: uuidSchema.safeParse(input.disciplineId).success,
      filled: filled(input.disciplineId),
    },
    {
      id: "researchTypes",
      focusKey,
      met: researchMet,
      filled: input.researchTypeCodes.length > 0 || filled(input.researchTypeOther),
    },
  ];
}

function contactRequirements(input: SectionProgressInput): SectionRequirement[] {
  const selection = selectionError(input);
  const requirements: SectionRequirement[] = [
    {
      id: "contactEmail",
      focusKey: "contactEmailId",
      met: uuidSchema.safeParse(input.contactEmailId).success,
      filled: filled(input.contactEmailId),
    },
  ];
  for (const kind of FUNDING_KINDS) {
    if (kind.detail === "NONE") continue;
    const message = selection.fundingFields[kind.code];
    if (!message) continue;
    const detail = input.funding.find((source) => source.code === kind.code)?.detail ?? "";
    requirements.push({
      id: `fundingDetail_${kind.code}`,
      focusKey: `fundingDetail_${kind.code}`,
      met: false,
      filled: filled(detail),
    });
  }
  return requirements;
}

function affiliationRequirements(input: SectionProgressInput): SectionRequirement[] {
  const requirements: SectionRequirement[] = [
    {
      id: "institution",
      focusKey: "institution",
      met: filled(input.institution),
      filled: filled(input.institution),
    },
  ];
  const parsed = profileDraftSchema.safeParse(input.affiliation);
  if (parsed.success) return requirements;
  const issues = new Map<string, true>();
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key) issues.set(key, true);
  }
  for (const key of AFFILIATION_FOCUS_ORDER) {
    if (!issues.has(key)) continue;
    requirements.push({
      id: key,
      focusKey: input.affiliationFocus?.[key] ?? key,
      met: false,
      filled: false,
    });
  }
  return requirements;
}

/**
 * Required items for each new-protocol section, read from the same Zod rules as create.
 * Institution is required, and its control sits in the affiliation card, so it counts there.
 * Where and how big only has optional fields.
 */
export function sectionProgress(input: SectionProgressInput): SectionProgress[] {
  const study = NEW_PROTOCOL_SECTIONS[0];
  const where = NEW_PROTOCOL_SECTIONS[1];
  const contact = NEW_PROTOCOL_SECTIONS[2];
  const affiliation = NEW_PROTOCOL_SECTIONS[3];
  const studyItems = studyRequirements(input);
  const contactItems = contactRequirements(input);
  const affiliationItems = affiliationRequirements(input);
  const affiliationFilled = Object.values(input.affiliation).some((value) => typeof value === "string" && filled(value));
  return [
    pack(study, studyItems, input.touched.study === true, studyItems.some((item) => item.filled)),
    pack(where, [], input.touched.where === true, false),
    pack(
      contact,
      contactItems,
      input.touched.contact === true,
      contactItems.some((item) => item.filled) || input.funding.length > 0,
    ),
    pack(affiliation, affiliationItems, input.touched.affiliation === true, affiliationFilled || filled(input.institution)),
  ];
}

export function sectionByKey(sections: readonly SectionProgress[], key: SectionKey): SectionProgress {
  const found = sections.find((section) => section.key === key);
  if (!found) throw new Error(`Missing section ${key}`);
  return found;
}

export function sectionStatusLabel(status: SectionStatus, missing: number): string {
  if (status === "optional") return "Optional";
  if (status === "complete") return "Complete";
  if (status === "in-progress") return missing === 1 ? "1 required left" : `${missing} required left`;
  return "";
}

export function sectionTone(status: SectionStatus, visited: boolean): "muted" | "warning" | "complete" {
  if (status === "complete") return "complete";
  if (status === "in-progress" && visited) return "warning";
  return "muted";
}

export function requiredFieldsLeft(sections: readonly Pick<SectionProgress, "missing">[]): number {
  return sections.reduce((sum, section) => sum + section.missing, 0);
}

export function requiredLeftLabel(count: number): string {
  if (count === 0) return "Ready to create";
  if (count === 1) return "1 required field left";
  return `${count} required fields left`;
}

/** Map a URL hash to a section id. Unknown hashes return null so the title is not focused instead. */
export function sectionIdFromHash(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  if (!value) return null;
  const known = NEW_PROTOCOL_SECTIONS.find((section) => section.id === value || section.headingId === value);
  if (known) return known.id;
  return HASH_ALIASES[value] ?? null;
}
