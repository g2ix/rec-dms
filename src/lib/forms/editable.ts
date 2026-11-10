import { isRowVisible, isSectionVisible } from "@/lib/forms/logic";
import type { RoleKey } from "@/lib/forms/roles";
import type { FormColumn, FormField, FormSchema } from "@/lib/forms/schema";

const NEVER_EDITABLE = new Set(["computed", "staticText", "signature", "fileRef"]);

export type EditableInstance = {
  status: "DRAFT" | "COMPLETE" | "LOCKED";
  filledByUserId?: string | null;
  data?: unknown;
};

export type EditableUser = { id: string };

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function rowShown(field: FormField, cells: unknown): boolean {
  const keys = field.showRowsWhenFilled;
  if (!keys || keys.length === 0) return true;
  const row = record(cells);
  return keys.some((key) => typeof row[key] === "string" && row[key].trim() !== "");
}

function roleMatches(fillers: readonly string[], roles: readonly string[]): boolean {
  return fillers.some((filler) => roles.includes(filler));
}

function stepAllows(steps: readonly string[] | undefined, currentStepKey: string | null): boolean {
  if (!steps || steps.length === 0) return true;
  return currentStepKey != null && steps.includes(currentStepKey);
}

function columnSteps(field: FormField, column: FormColumn): readonly string[] | undefined {
  return column.editableInSteps && column.editableInSteps.length > 0 ? column.editableInSteps : field.editableInSteps;
}

function columnEditable(field: FormField, column: FormColumn, roles: readonly RoleKey[], currentStepKey: string | null): boolean {
  if (column.type === "computed") return false;
  if (field.fillers.length > 0 && !roleMatches(field.fillers, roles)) return false;
  if (!roleMatches(column.fillers, roles)) return false;
  return stepAllows(columnSteps(field, column), currentStepKey);
}

export function getEditableFields(
  definition: { schema: FormSchema },
  instance: EditableInstance,
  user: EditableUser,
  roles: readonly RoleKey[],
  currentStepKey: string | null,
  allowedRows?: Record<string, readonly string[]>,
): Set<string> {
  const editable = new Set<string>();
  if (instance.status !== "DRAFT") return editable;
  if (instance.filledByUserId && instance.filledByUserId !== user.id) return editable;

  const data = instance.data ?? {};
  for (const section of definition.schema.sections) {
    if (!isSectionVisible(section, data)) continue;
    for (const field of section.fields) {
      addField(editable, field, roles, currentStepKey, data, allowedRows);
    }
  }
  return editable;
}

function addField(
  editable: Set<string>,
  field: FormField,
  roles: readonly RoleKey[],
  currentStepKey: string | null,
  data: unknown,
  allowedRows?: Record<string, readonly string[]>,
): void {
  if (field.bind || NEVER_EDITABLE.has(field.type)) return;
  if (field.type === "assessmentTable") {
    const table = record(record(data)[field.id]);
    for (const row of field.rows ?? []) {
      if (!isRowVisible(row, data)) continue;
      const cells = table[row.id];
      if (!rowShown(field, cells)) continue;
      for (const column of field.columns ?? []) {
        if (!columnEditable(field, column, roles, currentStepKey)) continue;
        if (column.authoredFrom && allowedRows && !(allowedRows[`${field.id}.${column.id}`] ?? []).includes(row.id)) continue;
        editable.add(`${field.id}.${row.id}.${column.id}`);
      }
    }
    return;
  }
  if (field.type === "repeatingTable") {
    const columns = (field.columns ?? []).filter((column) => column.type !== "computed");
    const openColumns = columns.filter((column) => columnEditable(field, column, roles, currentStepKey));
    for (const column of openColumns) editable.add(`${field.id}.${column.id}`);
    if (openColumns.length === columns.length && columns.length > 0 && roleMatches(field.fillers, roles) && stepAllows(field.editableInSteps, currentStepKey)) {
      editable.add(field.id);
    }
    return;
  }
  if (!roleMatches(field.fillers, roles)) return;
  if (!stepAllows(field.editableInSteps, currentStepKey)) return;
  editable.add(field.id);
}

export function isRepeatingColumnEditable(editable: Set<string>, fieldId: string, columnId: string): boolean {
  return editable.has(`${fieldId}.${columnId}`);
}

export function canChangeRepeatingRows(editable: Set<string>, fieldId: string): boolean {
  return editable.has(fieldId);
}
