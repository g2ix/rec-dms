import { normalizeSuffix, normalizeTitle, parseCredentials } from "@/lib/name-parts";

/** The name line printed for Researcher(s)/Proponent(s). Empty parts are left out. */
export function formatRecFormName(input: {
  title?: string | null;
  titleOther?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  suffix?: string | null;
  suffixOther?: string | null;
  credentials?: string | null;
}): string {
  const titleChoice = input.title?.trim() ?? "";
  const suffixChoice = input.suffix?.trim() ?? "";
  return formatFormalName({
    title: titleChoice === "other" ? normalizeTitle(input.titleOther) : normalizeTitle(titleChoice),
    firstName: input.firstName ?? "",
    middleName: input.middleName,
    familyName: input.familyName ?? "",
    suffix: suffixChoice === "other" ? normalizeSuffix(input.suffixOther) : normalizeSuffix(suffixChoice),
    credentials: parseCredentials(input.credentials),
  });
}

/** Department, school, and institution, skipping anything still blank. */
export function formatRecFormAffiliation(input: {
  department?: string | null;
  school?: string | null;
  institution?: string | null;
}): string {
  return [input.department, input.school, input.institution].map((part) => part?.trim() ?? "").filter(Boolean).join(", ");
}

export function formatDisplayName(
  firstName: string,
  middleName: string | null | undefined,
  familyName: string,
): string {
  const letter = middleName?.trim().match(/\p{L}/u)?.[0]?.toUpperCase();
  const middle = letter ? ` ${letter}.` : "";
  return `${firstName.trim()}${middle} ${familyName.trim()}`.replace(/\s+/g, " ").trim();
}

/** The name printed on a roster or a REC form. Screens keep the short display name. */
export function formatFormalName(input: {
  title?: string | null;
  firstName: string;
  middleName?: string | null;
  middleInitial?: string | null;
  familyName: string;
  suffix?: string | null;
  credentials?: readonly string[] | null;
}): string {
  const middle = input.middleName?.trim() || input.middleInitial;
  const short = formatDisplayName(input.firstName, middle, input.familyName);
  const title = input.title?.trim();
  const head = title ? `${title} ${short}` : short;
  const suffix = printSuffix(input.suffix);
  const named = suffix ? `${head} ${suffix}` : head;
  const credentials = (input.credentials ?? []).map((item) => item.trim()).filter(Boolean);
  return credentials.length > 0 ? `${named}, ${credentials.join(", ")}` : named;
}

function printSuffix(suffix: string | null | undefined): string {
  const text = suffix?.trim() ?? "";
  if (!text) return "";
  if (text === "Jr" || text === "Sr") return `${text}.`;
  return text;
}

export function splitPersonName(name: string | null | undefined): {
  firstName: string;
  middleInitial: string | null;
  familyName: string;
} {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "New", middleInitial: null, familyName: "User" };
  if (parts.length === 1) return { firstName: parts[0], middleInitial: null, familyName: parts[0] };
  const middle = parts.slice(1, -1).join(" ");
  return {
    firstName: parts[0],
    middleInitial: middle ? middle[0]!.toUpperCase() : null,
    familyName: parts[parts.length - 1]!,
  };
}
