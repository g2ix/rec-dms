import { eachField, type FormSchema } from "@/lib/forms/schema";

export type AuthoredSource = { code: string; data: unknown };

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

/** Rows this person already commented on, keyed by `fieldId.columnId` on the form being edited. */
export function authoredRowMap(schema: FormSchema, sources: AuthoredSource[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const field of eachField(schema)) {
    if (field.type !== "assessmentTable") continue;
    for (const column of field.columns ?? []) {
      const spec = column.authoredFrom;
      if (!spec) continue;
      const ids = new Set<string>();
      for (const source of sources) {
        if (!spec.forms.includes(source.code)) continue;
        const table = record(record(source.data)[spec.field]);
        for (const row of field.rows ?? []) {
          const cells = record(table[row.id]);
          const commented = spec.columns.some((id) => {
            const value = cells[id];
            if (typeof value === "boolean") return value === true;
            return typeof value === "string" && value.trim() !== "";
          });
          if (commented) ids.add(row.id);
        }
      }
      map[`${field.id}.${column.id}`] = [...ids];
    }
  }
  return map;
}
