import { formatInTimeZone } from "date-fns-tz";
import { validateInstance } from "@/lib/forms/validate";
import type { FormSchema } from "@/lib/forms/schema";

export function versionLabel(number: number, at: Date, timeZone: string): string {
  return `${number}/${formatInTimeZone(at, timeZone, "ddMMMyyyy")}`;
}

/** REC asks that a protocol title not be written in all capitals. */
export function isAllCapsTitle(title: string): boolean {
  const letters = title.replace(/[^A-Za-z]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase();
}

export function suggestedManuscriptName(label: string): string {
  const safe = label.replaceAll("/", "_").replace(/[^A-Za-z0-9._-]+/g, "_");
  return `Manuscript_${safe}.pdf`;
}

export type FormProgress = "Not started" | "In progress" | "Complete" | "Needs signatures";

export function formHasSignature(schema: FormSchema): boolean {
  return schema.sections.some((section) => section.fields.some((field) => field.type === "signature"));
}

export function formProgress(schema: FormSchema, data: unknown, revision: number): FormProgress {
  if (validateInstance({ schema }, data).length === 0) {
    return formHasSignature(schema) ? "Needs signatures" : "Complete";
  }
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (revision === 0 && Object.keys(record).length === 0) return "Not started";
  return "In progress";
}

export type FieldChange = { path: string; before: unknown; after: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Leaf differences between two form payloads. Arrays compare as one value. */
export function diffFieldValues(before: unknown, after: unknown, prefix = ""): FieldChange[] {
  const left = isRecord(before) ? before : {};
  const right = isRecord(after) ? after : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes: FieldChange[] = [];
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const earlier = left[key];
    const later = right[key];
    if (isRecord(earlier) && isRecord(later)) {
      changes.push(...diffFieldValues(earlier, later, path));
      continue;
    }
    if (JSON.stringify(earlier ?? null) !== JSON.stringify(later ?? null)) {
      changes.push({ path, before: earlier ?? null, after: later ?? null });
    }
  }
  return changes;
}

export function displayInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/\.$/, ""))
    .filter((word) => word.length > 1 || /^[A-Za-z]$/.test(word) === false);
  const usable = words.length > 0 ? words : name.split(/\s+/);
  const first = usable[0]?.[0] ?? "";
  const last = usable.length > 1 ? usable[usable.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}
