import { evaluateFormula, formulaPaths, parseFormula } from "@/lib/forms/compute";
import { formatCentavos } from "@/lib/forms/money";
import { findField, type FormField, type FormSchema } from "@/lib/forms/schema";

export function recompute(schema: FormSchema, data: Record<string, unknown>): { data: Record<string, unknown>; changed: string[] } {
  const next = { ...data };
  const fields = schema.sections
    .flatMap((section) => section.fields)
    .filter((field) => field.type === "computed" && field.formula);
  for (let pass = 0; pass < Math.max(fields.length, 1); pass += 1) {
    let moved = false;
    for (const field of fields) {
      let value = 0;
      try {
        value = evaluateFormula(parseFormula(field.formula ?? ""), next);
      } catch {
        value = 0;
      }
      if (next[field.id] !== value) {
        next[field.id] = value;
        moved = true;
      }
    }
    if (!moved) break;
  }
  const changed = fields.filter((field) => data[field.id] !== next[field.id]).map((field) => field.id);
  return { data: next, changed };
}

export function formulaUsesMoney(schema: FormSchema, formula: string | undefined): boolean {
  if (!formula) return false;
  try {
    return formulaPaths(parseFormula(formula)).some((path) => pathIsMoney(schema, path));
  } catch {
    return false;
  }
}

function pathIsMoney(schema: FormSchema, path: string[]): boolean {
  const field: FormField | undefined = findField(schema, path[0] ?? "");
  if (!field) return false;
  const last = path[path.length - 1];
  if (last && last !== "*" && field.columns) {
    const column = field.columns.find((item) => item.id === last);
    if (column) return column.type === "money";
  }
  return field.type === "money";
}

export function computedText(schema: FormSchema, field: FormField, data: Record<string, unknown>): string {
  if (!field.formula) return "";
  try {
    const value = evaluateFormula(parseFormula(field.formula), data);
    if (formulaUsesMoney(schema, field.formula)) return formatCentavos(Math.round(value));
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
  } catch {
    return "";
  }
}
