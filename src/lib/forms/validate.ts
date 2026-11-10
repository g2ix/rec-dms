import { isRowRequired, isRowVisible, isSectionVisible, logicIsTrue } from "@/lib/forms/logic";
import type { ColumnType, FormColumn, FormField, FormRow, FormSchema } from "@/lib/forms/schema";

export type FieldIssue = { path: string; message: string };

/** When set, a required cell is required only for the role and step that can edit it. */
export type ValidateContext = {
  roles?: readonly string[];
  stepKey?: string | null;
  /** Row ids the current person may edit, keyed by `fieldId.columnId`. */
  allowedRows?: Record<string, readonly string[]>;
};

type CheckMode = "draft" | "complete";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+().\-\s]{7,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateInstance(
  definition: { schema: FormSchema },
  data: unknown,
  context?: ValidateContext,
): FieldIssue[] {
  const record = asRecord(data);
  const issues: FieldIssue[] = [];
  for (const section of definition.schema.sections) {
    if (!isSectionVisible(section, record)) continue;
    for (const field of section.fields) {
      issues.push(...checkField(field, record[field.id], record, field.id, "complete", context));
    }
  }
  return issues;
}

export function validateDraftValue(field: FormField, value: unknown, data: unknown, path: string): FieldIssue[] {
  return checkField(field, value, asRecord(data), path, "draft");
}

function asRecord(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return {};
}

function checkField(
  field: FormField,
  value: unknown,
  data: Record<string, unknown>,
  path: string,
  mode: CheckMode,
  context?: ValidateContext,
): FieldIssue[] {
  if (field.type === "staticText" || field.type === "computed" || field.type === "signature" || field.type === "fileRef" || field.bind) {
    return [];
  }
  if (field.type === "repeatingTable") return checkRepeating(field, value, data, path, mode, context);
  if (field.type === "assessmentTable") return checkAssessment(field, value, data, path, mode, context);

  const issues: FieldIssue[] = [];
  const shape = shapeError(field.type, value, field.options, field.validation?.pattern, field.validation?.min, field.validation?.max);
  if (shape) issues.push({ path, message: shape });
  if (field.type === "yesNoNa") issues.push(...naIssues(value, field, path, mode));
  if (mode === "complete" && isRequired(field, data) && cellOpen(field.fillers, field.editableInSteps, context) && isEmpty(field.type, value)) {
    issues.push({ path, message: `${field.label} is required.` });
  }
  return issues;
}

function checkRepeating(
  field: FormField,
  value: unknown,
  data: Record<string, unknown>,
  path: string,
  mode: CheckMode,
  context?: ValidateContext,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (value == null) {
    if (mode === "complete" && isRequired(field, data) && cellOpen(field.fillers, field.editableInSteps, context)) {
      issues.push({ path, message: `${field.label} needs at least one row.` });
    }
    return issues;
  }
  if (!Array.isArray(value)) return [{ path, message: `${field.label} must be a table.` }];
  if (mode === "complete" && isRequired(field, data) && cellOpen(field.fillers, field.editableInSteps, context) && value.length === 0) {
    issues.push({ path, message: `${field.label} needs at least one row.` });
  }
  value.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      issues.push({ path: `${path}.${index}`, message: "A row is missing its values." });
      return;
    }
    const record = row as Record<string, unknown>;
    for (const column of field.columns ?? []) {
      const cell = record[column.id];
      const shape = columnShape(column, cell, field);
      if (shape) issues.push({ path: `${path}.${index}.${column.id}`, message: shape });
      if (
        mode === "complete" &&
        columnNeeded(field, column, data) &&
        column.type !== "computed" &&
        cellOpen(column.fillers, column.editableInSteps ?? field.editableInSteps, context) &&
        isEmpty(column.type, cell)
      ) {
        issues.push({ path: `${path}.${index}.${column.id}`, message: `${column.label} is required.` });
      }
    }
  });
  return issues;
}

function checkAssessment(
  field: FormField,
  value: unknown,
  data: Record<string, unknown>,
  path: string,
  mode: CheckMode,
  context?: ValidateContext,
): FieldIssue[] {
  if (mode === "draft" && (value == null || value === undefined)) return [];
  if (value != null && (typeof value !== "object" || Array.isArray(value))) {
    return [{ path, message: `${field.label} must be a table.` }];
  }
  const table = (value ?? {}) as Record<string, unknown>;
  const issues: FieldIssue[] = [];
  for (const row of field.rows ?? []) {
    const rowValue = table[row.id];
    const record = rowValue && typeof rowValue === "object" && !Array.isArray(rowValue) ? (rowValue as Record<string, unknown>) : {};
    if (rowValue != null && (typeof rowValue !== "object" || Array.isArray(rowValue))) {
      issues.push({ path: `${path}.${row.id}`, message: "A row is missing its values." });
      continue;
    }
    if (!assessmentRowShown(field, row, record, data)) continue;
    const required = mode === "complete" && assessmentRowRequired(field, row, data);
    for (const column of field.columns ?? []) {
      const cell = record[column.id];
      const shape = columnShape(column, cell, field);
      if (shape) issues.push({ path: `${path}.${row.id}.${column.id}`, message: shape });
      if (
        required &&
        column.type !== "computed" &&
        cellOpen(column.fillers, column.editableInSteps ?? field.editableInSteps, context) &&
        rowAllowed(field, column, row.id, context) &&
        isEmpty(column.type, cell)
      ) {
        issues.push({ path: `${path}.${row.id}.${column.id}`, message: `${row.code} ${column.label} is required.` });
      }
    }
  }
  return issues;
}

export function validateCellValue(field: FormField, columnId: string, value: unknown, path: string): FieldIssue[] {
  const column = field.columns?.find((item) => item.id === columnId);
  if (!column) return [{ path, message: "That column is not on this table." }];
  const shape = columnShape(column, value, field);
  return shape ? [{ path, message: shape }] : [];
}

function columnShape(column: FormColumn, value: unknown, field: FormField): string | null {
  const stringLike = column.type === "text" || column.type === "textarea" || column.type === "email" || column.type === "phone";
  const numberLike = column.type === "number" || column.type === "money";
  return shapeError(
    column.type,
    value,
    column.options,
    stringLike ? field.validation?.pattern : undefined,
    stringLike || numberLike ? field.validation?.min : undefined,
    stringLike || numberLike ? field.validation?.max : undefined,
  );
}

function rowShown(field: FormField, record: Record<string, unknown>): boolean {
  const keys = field.showRowsWhenFilled;
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => typeof record[key] === "string" && record[key].trim() !== "");
}

function assessmentRowShown(
  field: FormField,
  row: FormRow,
  record: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  if (!isRowVisible(row, data)) return false;
  return rowShown(field, record);
}

function assessmentRowRequired(field: FormField, row: FormRow, data: Record<string, unknown>): boolean {
  const fromRow = isRowRequired(row, data);
  if (fromRow != null) return fromRow;
  return isRequired(field, data);
}

function columnNeeded(field: FormField, column: FormColumn, data: Record<string, unknown>): boolean {
  if (column.required === true) return true;
  if (column.required === false) return false;
  const mixed = (field.columns ?? []).some((item) => item.required === true || item.required === false);
  if (mixed) return false;
  return isRequired(field, data);
}

function rowAllowed(field: FormField, column: FormColumn, rowId: string, context?: ValidateContext): boolean {
  if (!column.authoredFrom || !context?.allowedRows) return true;
  return (context.allowedRows[`${field.id}.${column.id}`] ?? []).includes(rowId);
}

function cellOpen(fillers: readonly string[] | undefined, steps: readonly string[] | undefined, context?: ValidateContext): boolean {
  if (!context?.roles) return true;
  if (steps && steps.length > 0 && !(context.stepKey && steps.includes(context.stepKey))) return false;
  if (fillers && fillers.length > 0 && !fillers.some((role) => context.roles?.includes(role))) return false;
  return true;
}

function isRequired(field: FormField, data: Record<string, unknown>): boolean {
  if (field.validation?.required) return true;
  if (field.validation?.requiredIf == null) return false;
  return logicIsTrue(field.validation.requiredIf, data);
}

function isEmpty(type: string, value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return false;
  if (typeof value === "boolean") return type === "declaration" ? value !== true : false;
  if (Array.isArray(value)) return value.length === 0;
  if (type === "yesNoNa" && typeof value === "object") {
    const choice = (value as { choice?: unknown }).choice;
    return choice !== "YES" && choice !== "NO" && choice !== "NA";
  }
  return false;
}

function naIssues(value: unknown, field: FormField, path: string, mode: CheckMode): FieldIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const choice = (value as { choice?: unknown }).choice;
  const reason = (value as { reason?: unknown }).reason;
  if (choice !== "NA") return [];
  const allowed = field.validation?.naAllowedWithReason === true;
  if (!allowed) return [{ path, message: "Not applicable is not allowed for this question." }];
  if (mode === "complete" && (typeof reason !== "string" || reason.trim() === "")) {
    return [{ path, message: "Explain why this is not applicable." }];
  }
  return [];
}

function shapeError(
  type: FieldTypeLike,
  value: unknown,
  options: { value: string }[] | undefined,
  pattern: string | undefined,
  min: number | undefined,
  max: number | undefined,
): string | null {
  if (value == null || value === "") return null;
  const allowed = new Set((options ?? []).map((option) => option.value));
  switch (type) {
    case "text":
    case "textarea":
    case "richtext":
    case "email":
    case "phone": {
      if (typeof value !== "string") return "Enter text.";
      if (type === "email" && !EMAIL.test(value)) return "Enter a valid email address.";
      if (type === "phone" && !PHONE.test(value)) return "Enter a phone number.";
      if (pattern && !safeTest(pattern, value)) return "This does not match the required pattern.";
      if (min != null && value.length < min) return `Use at least ${min} characters.`;
      if (max != null && value.length > max) return `Use at most ${max} characters.`;
      return null;
    }
    case "number":
    case "money": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
      if (type === "money" && !Number.isInteger(value)) return "Enter an amount in centavos.";
      if (min != null && value < min) return `The smallest allowed value is ${min}.`;
      if (max != null && value > max) return `The largest allowed value is ${max}.`;
      return null;
    }
    case "date":
      if (typeof value !== "string" || !DATE.test(value)) return "Enter a date.";
      return null;
    case "select":
    case "radio":
      if (typeof value !== "string" || !allowed.has(value)) return "Choose one of the listed options.";
      return null;
    case "checkboxes":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !allowed.has(item))) {
        return "Choose from the listed options.";
      }
      return null;
    case "yesNoNa": {
      if (typeof value !== "object" || Array.isArray(value)) return "Choose Yes, No, or Not applicable.";
      const choice = (value as { choice?: unknown }).choice;
      if (choice == null || choice === "") return null;
      if (choice !== "YES" && choice !== "NO" && choice !== "NA") return "Choose Yes, No, or Not applicable.";
      const reason = (value as { reason?: unknown }).reason;
      if (reason != null && typeof reason !== "string") return "The explanation must be text.";
      return null;
    }
    case "declaration":
      if (typeof value !== "boolean") return "Tick the declaration or leave it unticked.";
      return null;
    default:
      return null;
  }
}

type FieldTypeLike = FormField["type"] | ColumnType;

function safeTest(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}
