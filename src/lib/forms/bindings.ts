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

const PATHS = new Set(SHARED_BINDINGS.map((binding) => binding.path));

export function isKnownBinding(path: string): boolean {
  return PATHS.has(path);
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
};

export function formatBoundValue(value: unknown): string {
  if (value == null || value === "") return "Not entered yet";
  if (Array.isArray(value)) {
    const parts = value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
    return parts.length > 0 ? parts.join(", ") : "Not entered yet";
  }
  return String(value);
}
