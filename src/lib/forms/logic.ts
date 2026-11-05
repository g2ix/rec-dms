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
