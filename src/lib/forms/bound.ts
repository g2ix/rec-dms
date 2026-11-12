import type { FormSchema } from "@/lib/forms/schema";

/**
 * Bound values written into a form's data shape, so the renderer, validation, the signature hash
 * and printing read an intake-sourced form exactly as if the proponent had typed it:
 *
 * - a field with `bind` gets `bound[bind]`;
 * - an assessment column with `bind` gets `bound[bind][row.code]`, or "NA" when the scoping rules
 *   mark the point N/A (`bound["intake.na"][formCode][row.code]`, a list of reasons). The reasons
 *   are kept on the row as `_na` ("N/A (proponent: …)") for reviewers.
 *
 * The stored copy is never changed. Forms without `source: "intake"` are returned as they are,
 * so 09-01 and 10-01 copies keep their own data.
 */
export function overlayBound(
  schema: FormSchema,
  data: Record<string, unknown>,
  bound: Record<string, unknown>,
  formCode: string,
): Record<string, unknown> {
  if (schema.source !== "intake") return data;
  const out: Record<string, unknown> = structuredClone(data);
  const naByForm = record(bound["intake.na"]);
  const na = record(naByForm[formCode]);
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.bind) {
        const value = bound[field.bind];
        out[field.id] = value === undefined ? null : structuredClone(value);
        continue;
      }
      if (field.type !== "assessmentTable") continue;
      const columns = (field.columns ?? []).filter((column) => column.bind);
      const table = record(out[field.id]);
      for (const row of field.rows ?? []) {
        const cells = { ...record(table[row.id]) };
        const reasons = Array.isArray(na[row.code]) ? (na[row.code] as unknown[]).map(String) : [];
        if (reasons.length > 0) cells._na = `N/A (proponent: ${reasons.join("; ")})`;
        else delete cells._na;
        for (const column of columns) {
          if (row.reference === false && column.bind === "intake.references") continue;
          const source = record(bound[column.bind!]);
          const value = source[row.code];
          cells[column.id] = reasons.length > 0 && column.bind === "intake.references" ? "NA" : typeof value === "string" ? value : null;
        }
        if (Object.keys(cells).length > 0) table[row.id] = cells;
      }
      out[field.id] = table;
    }
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
