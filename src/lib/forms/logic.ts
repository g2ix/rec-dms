import jsonLogic from "json-logic-js";

export function logicIsTrue(rule: unknown, data: unknown): boolean {
  try {
    return jsonLogic.apply(rule, data ?? {}) === true;
  } catch {
    return false;
  }
}

export function isSectionVisible(section: { visibleIf?: unknown }, data: unknown): boolean {
  if (section.visibleIf == null) return true;
  return logicIsTrue(section.visibleIf, data);
}

export function isRowVisible(row: { visibleIf?: unknown }, data: unknown): boolean {
  if (row.visibleIf == null) return true;
  return logicIsTrue(row.visibleIf, data);
}

export function isRowRequired(row: { requiredIf?: unknown }, data: unknown): boolean | null {
  if (row.requiredIf == null) return null;
  return logicIsTrue(row.requiredIf, data);
}
