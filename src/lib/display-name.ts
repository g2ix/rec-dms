export function formatDisplayName(
  firstName: string,
  middleInitial: string | null | undefined,
  familyName: string,
): string {
  const initial = middleInitial?.trim().replace(/\.$/, "");
  const middle = initial ? ` ${initial}.` : "";
  return `${firstName.trim()}${middle} ${familyName.trim()}`.replace(/\s+/g, " ").trim();
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
