import { isSectionVisible } from "@/lib/forms/logic";
import type { RoleKey } from "@/lib/forms/roles";
import type { FormColumn, FormField, FormSchema } from "@/lib/forms/schema";

const NEVER_EDITABLE = new Set(["computed", "staticText", "signature", "fileRef"]);

export type EditableInstance = {
  status: "DRAFT" | "COMPLETE" | "LOCKED";
  filledByUserId?: string | null;
  data?: unknown;
};

export type EditableUser = { id: string };

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
): Set<string> {
  const editable = new Set<string>();
  if (instance.status !== "DRAFT") return editable;
  if (instance.filledByUserId && instance.filledByUserId !== user.id) return editable;

  const data = instance.data ?? {};
  for (const section of definition.schema.sections) {
    if (!isSectionVisible(section, data)) continue;
    for (const field of section.fields) {
      addField(editable, field, roles, currentStepKey);
    }
  }
  return editable;
}

function addField(editable: Set<string>, field: FormField, roles: readonly RoleKey[], currentStepKey: string | null): void {
  if (field.bind || NEVER_EDITABLE.has(field.type)) return;
  if (field.type === "assessmentTable") {
    for (const row of field.rows ?? []) {
      for (const column of field.columns ?? []) {
        if (columnEditable(field, column, roles, currentStepKey)) {
          editable.add(`${field.id}.${row.id}.${column.id}`);
        }
      }
    }
    return;
  }
  if (field.type === "repeatingTable") {
    const columns = field.columns ?? [];
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
