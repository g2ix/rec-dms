/**
 * Client-type rules: `[{ "clientTypeKey": "...", "when": { fact: condition, ... } }]`, read from the
 * `fees.clientTypeRules` setting. The first rule whose every condition holds wins. Nothing here
 * names a client type; the rules are data.
 *
 * Facts come from the project leader's affiliation on the protocol (copied from their profile)
 * and from the application form: `profileKind`, `academicLevel`, `affiliationKind`, `institution`,
 * `schoolName`, `departmentName`, `officeName`, `programName`, `course`, `position`, and `funds`
 * (the F-27 source-of-funds codes).
 *
 * A condition is one of:
 * - a string: the fact equals it, or, for a list fact such as `funds`, the list contains it;
 * - a list of strings: any of them, by the same test;
 * - `{ "matches": "regex" }`: the fact (or any item of a list fact) matches, ignoring case;
 * - `{ "not": condition }`: the condition does not hold.
 */

export type ClientTypeFacts = Record<string, string | string[] | null | undefined>;

export type ClientTypeRule = { clientTypeKey: string; when: Record<string, unknown> };

export function parseClientTypeRules(value: unknown): ClientTypeRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { clientTypeKey, when } = item as { clientTypeKey?: unknown; when?: unknown };
    if (typeof clientTypeKey !== "string" || !clientTypeKey.trim()) return [];
    const conditions = when && typeof when === "object" && !Array.isArray(when) ? (when as Record<string, unknown>) : {};
    return [{ clientTypeKey, when: conditions }];
  });
}

function values(fact: ClientTypeFacts[string]): string[] {
  if (Array.isArray(fact)) return fact.filter((item): item is string => typeof item === "string");
  return typeof fact === "string" && fact !== "" ? [fact] : [];
}

function holds(fact: ClientTypeFacts[string], condition: unknown): boolean {
  const present = values(fact);
  if (typeof condition === "string") return present.includes(condition);
  if (Array.isArray(condition)) return condition.some((item) => typeof item === "string" && present.includes(item));
  if (condition && typeof condition === "object") {
    const shape = condition as { matches?: unknown; not?: unknown };
    if ("not" in shape) return !holds(fact, shape.not);
    if (typeof shape.matches === "string") {
      let pattern: RegExp;
      try {
        pattern = new RegExp(shape.matches, "i");
      } catch {
        return false;
      }
      return present.some((item) => pattern.test(item));
    }
  }
  if (condition === null) return present.length === 0;
  return false;
}

/** The client type the first matching rule names, or null. */
export function matchClientType(rules: ClientTypeRule[], facts: ClientTypeFacts): string | null {
  for (const rule of rules) {
    if (Object.entries(rule.when).every(([key, condition]) => holds(facts[key], condition))) return rule.clientTypeKey;
  }
  return null;
}
