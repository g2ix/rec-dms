/**
 * Panel member list import. The sheet has a header row with Panel, No., Name, Designation,
 * Discipline, Affiliation, Email, and an optional second email in the next column. The panel
 * cell is filled down. Nothing here names a panel or a person.
 */

export type MemberAttributes = {
  designation: string;
  isScientist: boolean | null;
  discipline: string;
  affiliate: boolean | null;
  alternate: boolean;
};

export type ImportRow = {
  sheetRow: number;
  panelCode: string;
  panelName: string;
  name: string;
  email: string | null;
  extraEmail: string | null;
  roleKey: string;
  attributes: MemberAttributes;
};

export type RoleRule = { match: string; role: string };

/** Designation words to role keys, first match wins. Overridden by the `panels.importRoles` setting. */
export const DEFAULT_ROLE_RULES: RoleRule[] = [
  { match: "vice", role: "PANEL_VICE_CHAIR" },
  { match: "secretary", role: "PANEL_SECRETARY" },
  { match: "chair", role: "PANEL_CHAIR" },
];
export const DEFAULT_MEMBER_ROLE = "PANEL_MEMBER";

const HEADERS: Record<string, keyof ColumnMap> = {
  panel: "panel",
  "no.": "number",
  no: "number",
  name: "name",
  designation: "designation",
  discipline: "discipline",
  affiliation: "affiliation",
  email: "email",
  "extra email": "extraEmail",
};

type ColumnMap = {
  panel?: string;
  number?: string;
  name?: string;
  designation?: string;
  discipline?: string;
  affiliation?: string;
  email?: string;
  extraEmail?: string;
};

function nextColumn(column: string): string {
  const chars = column.split("");
  let index = chars.length - 1;
  while (index >= 0) {
    if (chars[index] !== "Z") {
      chars[index] = String.fromCharCode(chars[index]!.charCodeAt(0) + 1);
      return chars.join("");
    }
    chars[index] = "A";
    index -= 1;
  }
  return `A${chars.join("")}`;
}

export function parsePanel(text: string): { code: string; name: string } | null {
  const match = /panel\s*(\d+)/i.exec(text);
  if (!match) return null;
  return { code: `P${match[1]}`, name: `Panel ${match[1]}` };
}

export function scientistFlag(designation: string): boolean | null {
  if (/non[\s-]*scientist/i.test(designation)) return false;
  if (/scientist/i.test(designation)) return true;
  return null;
}

export function affiliateFlag(text: string): boolean | null {
  if (/non[\s-]*affiliate/i.test(text)) return false;
  if (/affiliate/i.test(text)) return true;
  return null;
}

export function roleFor(designation: string, rules: RoleRule[] = DEFAULT_ROLE_RULES): string {
  const lower = designation.toLowerCase();
  return rules.find((rule) => lower.includes(rule.match.toLowerCase()))?.role ?? DEFAULT_MEMBER_ROLE;
}

function email(text: string | undefined): string | null {
  const value = (text ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function parseMemberSheet(
  rows: { row: number; cells: Record<string, string> }[],
  rules: RoleRule[] = DEFAULT_ROLE_RULES,
): { rows: ImportRow[]; skipped: { sheetRow: number; reason: string }[] } {
  const headerIndex = rows.findIndex((row) => Object.values(row.cells).some((value) => value.trim().toLowerCase() === "designation"));
  if (headerIndex < 0) throw new Error("The sheet has no header row with Designation.");
  const columns: ColumnMap = {};
  for (const [column, value] of Object.entries(rows[headerIndex]!.cells)) {
    const key = HEADERS[value.trim().toLowerCase()];
    if (key) columns[key] = column;
  }
  if (!columns.name || !columns.designation || !columns.email) throw new Error("The sheet needs Name, Designation, and Email columns.");
  if (!columns.extraEmail) columns.extraEmail = nextColumn(columns.email);
  const out: ImportRow[] = [];
  const skipped: { sheetRow: number; reason: string }[] = [];
  let panel: { code: string; name: string } | null = null;
  for (const row of rows.slice(headerIndex + 1)) {
    const get = (key: keyof ColumnMap) => (columns[key] ? (row.cells[columns[key]!] ?? "").trim() : "");
    const panelText = get("panel");
    if (panelText) panel = parsePanel(panelText) ?? panel;
    const rawName = get("name");
    if (!rawName) continue;
    if (!panel) {
      skipped.push({ sheetRow: row.row, reason: "No panel above this row." });
      continue;
    }
    const alternate = /\(([^)]*altern[^)]*)\)/i.test(rawName);
    const name = rawName.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    const designation = get("designation");
    const primary = email(get("email"));
    if (!primary) {
      skipped.push({ sheetRow: row.row, reason: `${name} has no email address, so no account can be matched.` });
      continue;
    }
    out.push({
      sheetRow: row.row,
      panelCode: panel.code,
      panelName: panel.name,
      name,
      email: primary,
      extraEmail: email(get("extraEmail")),
      roleKey: roleFor(designation, rules),
      attributes: {
        designation,
        isScientist: scientistFlag(designation),
        discipline: get("discipline"),
        affiliate: affiliateFlag(get("affiliation")),
        alternate,
      },
    });
  }
  return { rows: out, skipped };
}

const TITLES = new Set(["atty.", "engr.", "dr.", "prof.", "mr.", "ms.", "mrs.", "fr.", "sr.", "rev."]);

/** Splits "Title First M. Family, Credentials" into name parts. */
export function splitName(full: string): {
  title: string | null;
  firstName: string;
  middleInitial: string | null;
  familyName: string;
  credentials: string[];
} {
  const [main = "", ...rest] = full.split(",");
  const credentials = rest.map((item) => item.trim()).filter(Boolean);
  const words = main.trim().split(/\s+/).filter(Boolean);
  let title: string | null = null;
  if (words.length > 1 && TITLES.has(words[0]!.toLowerCase())) title = words.shift() ?? null;
  const familyName = words.length > 1 ? (words.pop() ?? "") : (words[0] ?? "");
  let middleInitial: string | null = null;
  const last = words.at(-1);
  if (words.length > 1 && last && /^[A-Za-z]\.?$/.test(last)) {
    middleInitial = last.replace(".", "").toUpperCase();
    words.pop();
  }
  const firstName = words.join(" ") || familyName;
  return { title, firstName, middleInitial, familyName, credentials };
}

export function sameAttributes(a: unknown, b: MemberAttributes): boolean {
  if (!a || typeof a !== "object") return false;
  const left = a as Record<string, unknown>;
  return (
    left.designation === b.designation &&
    (left.isScientist ?? null) === b.isScientist &&
    left.discipline === b.discipline &&
    (left.affiliate ?? null) === b.affiliate &&
    Boolean(left.alternate) === b.alternate
  );
}
