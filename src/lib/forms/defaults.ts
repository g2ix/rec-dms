import { eachField, type FormColumn, type FormField, type FormSchema } from "@/lib/forms/schema";

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function cellEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function columnOpen(field: FormField, column: FormColumn, roles: readonly string[], stepKey: string | null): boolean {
  if (roles.length === 0) return false;
  if (!column.fillers.some((role) => roles.includes(role))) return false;
  const steps = column.editableInSteps ?? field.editableInSteps;
  if (steps && steps.length > 0 && !(stepKey && steps.includes(stepKey))) return false;
  return true;
}

/** Fill empty assessment cells that declare a defaultValue for the columns this person can edit. */
export function applyAssessmentDefaults(
  schema: FormSchema,
  data: unknown,
  roles: readonly string[] = [],
  stepKey: string | null = null,
): Record<string, unknown> {
  const next = record(data);
  let changed = false;
  for (const field of eachField(schema)) {
    if (field.type !== "assessmentTable") continue;
    const columns = (field.columns ?? []).filter(
      (column) => column.defaultValue !== undefined && columnOpen(field, column, roles, stepKey),
    );
    if (columns.length === 0) continue;
    const table = record(next[field.id]);
    for (const row of field.rows ?? []) {
      const cells = record(table[row.id]);
      let rowChanged = false;
      for (const column of columns) {
        if (!cellEmpty(cells[column.id])) continue;
        cells[column.id] = column.defaultValue as unknown;
        rowChanged = true;
      }
      if (rowChanged) {
        table[row.id] = cells;
        changed = true;
      }
    }
    if (changed) next[field.id] = table;
  }
  return changed ? next : record(data);
}

export function columnDefault(schema: FormSchema, fieldId: string, columnId: string): unknown {
  for (const field of eachField(schema)) {
    if (field.id !== fieldId) continue;
    return field.columns?.find((column) => column.id === columnId)?.defaultValue;
  }
  return undefined;
}

export function valueDiffersFromDefault(value: unknown, defaultValue: unknown): boolean {
  if (defaultValue === undefined) {
    return typeof value === "string" ? value.trim() !== "" : value != null && value !== "";
  }
  if (typeof defaultValue === "string") {
    const text = typeof value === "string" ? value.trim() : value == null || value === "" ? "" : String(value).trim();
    return text !== defaultValue.trim();
  }
  return value !== defaultValue;
}
