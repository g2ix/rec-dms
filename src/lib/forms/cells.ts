/** Whether an assessment cell counts as filled for showRowsWhenFilled / print filters. */
export function cellFilled(value: unknown): boolean {
  if (typeof value === "boolean") return value === true;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number") return Number.isFinite(value);
  return false;
}

export function rowHasFilled(cells: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => cellFilled(cells[key]));
}

export function asCellRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}
