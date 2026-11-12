function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const QUALIFIER = /^(?:approx(?:imately)?\.?|about|around|estimated|est\.?|roughly|at least|more or less|~)\s*/i;

/**
 * The number an old free-text F-27 answer starts with: "6 months", "approx. 1,200 respondents",
 * "30 Grade 10 students". Null when the answer does not start with one ("about thirty Grade 10
 * learners" has a 10, but not as the count), so such a value is logged and left for the proponent.
 */
export function leadingNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  let rest = text(value);
  for (let guard = 0; guard < 3 && QUALIFIER.test(rest); guard += 1) rest = rest.replace(QUALIFIER, "");
  const match = rest.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?!\.\d)/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!.replaceAll(",", ""), 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
