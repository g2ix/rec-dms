export type SharedBinding = {
  path: string;
  label: string;
  many: boolean;
};

/** Protocol fields entered once and shown read-only on every form that binds them. */
export const SHARED_BINDINGS: readonly SharedBinding[] = [
  { path: "protocol.code", label: "Protocol code", many: false },
  { path: "protocol.title", label: "Title", many: false },
  { path: "protocol.versionLabel", label: "Version", many: false },
  { path: "protocol.researchers", label: "Researchers", many: true },
  { path: "protocol.contactNumbers", label: "Contact numbers", many: true },
  { path: "protocol.emails", label: "Emails", many: true },
  { path: "protocol.institution", label: "Institution", many: false },
  { path: "protocol.institutionAddress", label: "Institution address", many: false },
  { path: "protocol.submissionDate", label: "Submission date", many: false },
];

/**
 * Paths an intake-sourced form (`source: "intake"`) can also bind. protocol.* comes from the
 * Details page, intake.* from the intake, team.* from the roster and its agreements, system.*
 * from the workflow. Every bound field is read-only on the form.
 */
export const INTAKE_BINDINGS: readonly SharedBinding[] = [
  { path: "protocol.researchTypeCodes", label: "Research type", many: true },
  { path: "protocol.researchTypeOther", label: "Research type (other)", many: false },
  { path: "protocol.durationMonths", label: "Duration in months", many: false },
  { path: "protocol.expectedParticipants", label: "Expected participants", many: false },
  { path: "protocol.studySite", label: "Study site", many: false },
  { path: "protocol.fundingCodes", label: "Sources of funds", many: true },
  { path: "protocol.fundingDetail.INSTITUTION", label: "Funding institution", many: false },
  { path: "protocol.fundingDetail.AGENCY", label: "Funding agency", many: false },
  { path: "protocol.fundingDetail.OTHER", label: "Other source of funds", many: false },
  { path: "intake.coi.kind", label: "Conflict of interest", many: false },
  { path: "intake.coi.text", label: "Conflict of interest details", many: false },
  { path: "intake.scoping.consentNeeded", label: "Consent needed", many: false },
  { path: "intake.scoping.waiverReason", label: "Reason consent is not needed", many: false },
  { path: "intake.declarations", label: "Declarations agreed by every researcher", many: false },
  { path: "intake.consents", label: "Data privacy consents agreed by every researcher", many: false },
  { path: "intake.budget.PS", label: "Personnel Services", many: true },
  { path: "intake.budget.MOOE", label: "MOOE", many: true },
  { path: "intake.budget.CAPITAL", label: "Capital Outlay", many: true },
  { path: "intake.budget.ADMIN", label: "Administrative Cost", many: true },
  { path: "intake.budget.externalSource", label: "Name of external source", many: false },
  { path: "team.researchers", label: "Researchers and their sign-off", many: true },
  { path: "system.reviewType", label: "Type of review", many: false },
];

/** Bound values nobody types: the app or the REC office sets them. The note says when. */
export const SET_BY_SYSTEM: Readonly<Record<string, string>> = {
  "protocol.code": "Assigned by the REC office after screening",
  "protocol.versionLabel": "Set from the version number and its date",
  "protocol.submissionDate": "Filled in when you submit",
  "system.reviewType": "Set by the REC when the review type is decided",
};

/** Paths an assessment column can bind. The value is a map keyed by point code. */
export const COLUMN_BINDINGS: readonly SharedBinding[] = [
  { path: "intake.references", label: "Page and line references", many: true },
  { path: "intake.actions", label: "Actions taken", many: true },
];

const PATHS = new Set(SHARED_BINDINGS.map((binding) => binding.path));
const INTAKE_PATHS = new Set(INTAKE_BINDINGS.map((binding) => binding.path));
const COLUMN_PATHS = new Set(COLUMN_BINDINGS.map((binding) => binding.path));

/** `intake` allows the wider set used by intake-sourced forms. */
export function isKnownBinding(path: string, intake = false): boolean {
  return PATHS.has(path) || (intake && INTAKE_PATHS.has(path));
}

export function isKnownColumnBinding(path: string): boolean {
  return COLUMN_PATHS.has(path);
}

/** Values shown on the sandbox and the builder preview until a protocol supplies the real ones. */
export const PREVIEW_BOUND_VALUES: Record<string, unknown> = {
  "protocol.code": "USC-REC-2026-0001",
  "protocol.title": "Classroom study of study habits",
  "protocol.versionLabel": "1/05Nov2026",
  "protocol.researchers": ["Juan D. Cruz"],
  "protocol.contactNumbers": ["09171234567"],
  "protocol.emails": ["juan.cruz@usc.edu.ph"],
  "protocol.institution": "University of San Carlos",
  "protocol.institutionAddress": "Talamban, Cebu City",
  "protocol.submissionDate": "2026-11-05",
  "protocol.researchTypeCodes": ["SOCIAL_BEHAVIORAL"],
  "protocol.durationMonths": 6,
  "protocol.expectedParticipants": 30,
  "protocol.studySite": "University of San Carlos, Talamban",
  "protocol.fundingCodes": ["RESEARCHER"],
  "intake.coi.kind": "NONE",
  "intake.references": {},
  "intake.actions": {},
  "team.researchers": [{ name: "Juan D. Cruz" }],
};

export function formatBoundValue(value: unknown): string {
  if (value == null || value === "") return "Not entered yet";
  if (Array.isArray(value)) {
    const parts = value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "name" in item) return String((item as { name: unknown }).name);
      return JSON.stringify(item);
    });
    return parts.length > 0 ? parts.join(", ") : "Not entered yet";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
