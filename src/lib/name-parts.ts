const PART = /^[\p{L}][\p{L}\s.'-]*$/u;

export const TITLE_CHOICES = ["Mr", "Ms", "Mrs", "Engr.", "Dr", "Prof.", "Atty."] as const;
export const SUFFIX_CHOICES = ["Jr", "II", "III", "IV"] as const;
export const CREDENTIAL_CHOICES = ["PhD", "MSIT", "MEng", "CPA", "MD", "MA", "MS"] as const;

export type NameParts = {
  title: string | null;
  middleName: string | null;
  middleInitial: string | null;
  suffix: string | null;
  credentials: string[];
};

function knownChoice(value: string, choices: readonly string[]): string | null {
  const folded = value.toLowerCase().replace(/\.$/, "");
  return choices.find((choice) => choice.toLowerCase().replace(/\.$/, "") === folded) ?? null;
}

export function normalizeTitle(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  const known = knownChoice(text, TITLE_CHOICES);
  if (known) return known;
  if (!PART.test(text) || text.length > 40) return null;
  return text;
}

export function normalizeSuffix(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\.$/, "") ?? "";
  if (!text) return null;
  const known = knownChoice(text, SUFFIX_CHOICES);
  if (known) return known;
  if (!PART.test(text) || text.length > 20) return null;
  return text;
}

export function normalizeMiddleName(value: string | null | undefined): string | null {
  const text = value?.trim().replace(/\.$/, "") ?? "";
  if (!text) return null;
  if (!PART.test(text) || text.length > 80) return null;
  return text;
}

/** The letter printed in "Juan D. Cruz". It is the first letter of the middle name. */
export function initialFromMiddleName(middleName: string | null | undefined): string | null {
  const letter = normalizeMiddleName(middleName)?.match(/\p{L}/u)?.[0];
  return letter ? letter.toUpperCase() : null;
}

/**
 * One stored middle name. A lone initial from an older account is kept as that name
 * so the short form still has a letter until the person types the full name.
 */
export function resolveMiddle(
  middleName: string | null | undefined,
  legacyInitial?: string | null,
): { middleName: string | null; middleInitial: string | null } {
  const name = normalizeMiddleName(middleName) ?? normalizeMiddleName(legacyInitial);
  return { middleName: name, middleInitial: initialFromMiddleName(name) };
}

/** What the single middle-name field shows. An older letter-only account fills the field with that letter. */
export function middleNameForForm(middleName?: string | null, legacyInitial?: string | null): string {
  return normalizeMiddleName(middleName) ?? normalizeMiddleName(legacyInitial) ?? "";
}

export function parseCredentials(value: unknown): string[] {
  const source = Array.isArray(value) ? value.map((item) => String(item)) : [String(value ?? "")];
  const seen = new Set<string>();
  const credentials: string[] = [];
  for (const item of source.join(",").split(/[,;/]+/)) {
    const text = item.trim().replace(/\.$/, "");
    if (!text || text.length > 20 || !/^[\p{L}][\p{L}\d.'-]*$/u.test(text)) continue;
    const known = knownChoice(text, CREDENTIAL_CHOICES);
    const canonical = known ?? text;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    credentials.push(canonical);
    if (credentials.length === 8) break;
  }
  return credentials;
}

export function readTitle(formData: FormData): string | null {
  const choice = String(formData.get("title") ?? "").trim();
  const raw = choice === "other" ? String(formData.get("titleOther") ?? "") : choice;
  return normalizeTitle(raw);
}

export function readSuffix(formData: FormData): string | null {
  const choice = String(formData.get("suffix") ?? "").trim();
  const raw = choice === "other" ? String(formData.get("suffixOther") ?? "") : choice;
  return normalizeSuffix(raw);
}

export function readNameParts(formData: FormData): NameParts {
  const middle = resolveMiddle(String(formData.get("middleName") ?? ""));
  return {
    title: readTitle(formData),
    middleName: middle.middleName,
    middleInitial: middle.middleInitial,
    suffix: readSuffix(formData),
    credentials: parseCredentials(formData.get("credentials")),
  };
}
