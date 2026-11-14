import { columnVisibleToRoles, fieldVisibleToRoles } from "@/lib/forms/editable";
import type { FormSchema } from "@/lib/forms/schema";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Field paths these roles may not see: whole fields (`field`) and table columns (`field.*.column`).
 * The same `visibleToRoles` rule the on-screen form uses, so a printed copy hides what the page hides.
 */
export function hiddenForRoles(schema: FormSchema, roles: readonly string[]): { fields: string[]; columns: { field: string; column: string }[] } {
  const fields: string[] = [];
  const columns: { field: string; column: string }[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!fieldVisibleToRoles(field, roles)) {
        fields.push(field.id);
        continue;
      }
      for (const column of field.columns ?? []) {
        if (!columnVisibleToRoles(column, roles)) columns.push({ field: field.id, column: column.id });
      }
    }
  }
  return { fields, columns };
}

/** A copy of the form data without anything these roles may not see. The stored data is not changed. */
export function dataForRoles(schema: FormSchema, data: Record<string, unknown>, roles: readonly string[]): Record<string, unknown> {
  const hidden = hiddenForRoles(schema, roles);
  if (hidden.fields.length === 0 && hidden.columns.length === 0) return data;
  const copy = structuredClone(data);
  for (const field of hidden.fields) delete copy[field];
  for (const { field, column } of hidden.columns) {
    const value = copy[field];
    if (Array.isArray(value)) {
      for (const row of value) {
        const cells = record(row);
        if (cells) delete cells[column];
      }
      continue;
    }
    const table = record(value);
    if (!table) continue;
    for (const row of Object.values(table)) {
      const cells = record(row);
      if (cells) delete cells[column];
    }
  }
  return copy;
}

/** Whether a signature at this field path sits in something these roles may not see. */
export function signatureHidden(fieldPath: string, hidden: ReturnType<typeof hiddenForRoles>): boolean {
  const head = fieldPath.split(/[.[]/)[0] ?? fieldPath;
  if (hidden.fields.includes(head)) return true;
  return hidden.columns.some(({ field, column }) => head === field && new RegExp(`(^|[.\\]])${column}($|[.[])`).test(fieldPath.slice(head.length)));
}
