import { formatInTimeZone } from "date-fns-tz";
import { formatCentavos } from "@/lib/forms/money";
import { effectiveCell, findField, overrideMap, type FormSchema } from "@/lib/forms/schema";
import { normalize, type PlaceholderEntry, type PlaceholderMap } from "@/lib/docs/tags";

const CHECKED = "☑";
const UNCHECKED = "☐";

const CHOICE_LABELS: Record<string, string> = {
  YES: "Yes",
  NO: "No",
  NA: "NA",
  UNABLE: "Unable to assess",
  APPROVED: "APPROVED",
  MINOR: "MINOR MODIFICATIONS REQUIRED",
  MAJOR: "MAJOR MODIFICATIONS REQUIRED",
  DISAPPROVED: "DISAPPROVED",
  EXEMPTED: "Exempted",
  QUALIFIED: "QUALIFIED FOR EXEMPTION",
  NOT_QUALIFIED: "NOT QUALIFIED FOR EXEMPTION",
  INITIAL: "Initial Submission",
  COMPLETION: "Study Completion Report and Final Paper",
  RESUBMISSION: "Resubmission for re-review",
  CONTINUING: "Continuing Review of Approved Protocols",
  AMENDMENT: "Protocol Amendments",
  TERMINATION: "Protocol Termination",
  OTHER: "Others",
  NONE: "No risk",
  BELOW_MINIMAL: "Below minimal risk",
  MINIMAL: "Minimal risk",
  GREATER: "Greater than minimal risk",
  EXPEDITED: "Expedited Review",
  FULL: "Full Review",
  DEVIATION: "Deviation / Violations",
  APPEAL: "Appeal",
  SAE: "SAE / SUSAR",
};

const BUDGET_MATCH: Record<string, RegExp> = {
  salaries: /salar/i,
  honoraria: /honor/i,
  travel: /travel/i,
  supplies: /suppl/i,
  incentive: /incentiv|respondent/i,
};

export type SignatureRender = {
  fieldPath: string;
  signerName: string;
  signedAt: Date;
  verifyRef: string;
  image: Buffer | null;
};

export type RenderImage = {
  key: string;
  bytes: Buffer;
  width: number;
  height: number;
};

export type RenderModel = {
  data: Record<string, unknown>;
  images: RenderImage[];
};

type BudgetLayout = {
  named: Map<string, Record<string, unknown> | null>;
  rest: Map<string, Record<string, unknown>[]>;
};

/** Wraps text that fillDocx prints with a yellow highlight. Private-use characters, removed after rendering. */
export const HIGHLIGHT_START = "\uE000";
export const HIGHLIGHT_END = "\uE001";

export type RenderOptions = {
  /** Field paths (and signature fields) left out of this copy. The stored form is not changed. */
  redact?: string[];
  /** false prints an overriding column in place of the original wherever the override is filled. */
  showOriginal?: boolean;
};

export function buildRenderModel(input: {
  map: PlaceholderMap;
  data: Record<string, unknown>;
  bound: Record<string, unknown>;
  signatures: SignatureRender[];
  schema?: FormSchema;
  timeZone?: string;
  options?: RenderOptions;
}): RenderModel {
  const images: RenderImage[] = [];
  const data: Record<string, unknown> = {};
  const zone = input.timeZone ?? "Asia/Manila";
  const source = redacted(input, input.options?.redact ?? []);
  const budget = layoutBudget(source.data);
  for (const [tag, raw] of Object.entries(input.map)) {
    const entry = normalize(raw);
    if (!entry) continue;
    const value = resolveEntry(tag, entry, source, images, zone, budget);
    assign(data, tag, value);
  }
  return { data, images };
}

function redacted<T extends { data: Record<string, unknown>; bound: Record<string, unknown>; signatures: SignatureRender[] }>(
  input: T,
  paths: string[],
): T {
  if (paths.length === 0) return input;
  const data = structuredClone(input.data);
  const bound = { ...input.bound };
  for (const path of paths) {
    removePath(data, path);
    for (const key of Object.keys(bound)) if (key === path || key.startsWith(`${path}.`)) delete bound[key];
  }
  const signatures = input.signatures.filter(
    (item) => !paths.some((path) => item.fieldPath === path || item.fieldPath.startsWith(`${path}.`) || item.fieldPath.startsWith(`${path}[`)),
  );
  return { ...input, data, bound, signatures };
}

function removePath(source: Record<string, unknown>, path: string): void {
  const parts = path.split(".");
  let cursor: unknown = source;
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!isRecord(cursor)) return;
    cursor = cursor[parts[index]!];
  }
  if (isRecord(cursor)) delete cursor[parts[parts.length - 1]!];
}

export function signedFooterLine(signatures: SignatureRender[], timeZone = "Asia/Manila"): string {
  const lines = signatures
    .filter((item) => item.verifyRef)
    .map((item) => {
      const when = formatInTimeZone(item.signedAt, timeZone, "yyyy-MM-dd HH:mm");
      return `Signed electronically by ${item.signerName}, ${when} PHT, ref ${item.verifyRef}`;
    });
  return lines.join("; ");
}

function resolveEntry(
  tag: string,
  entry: Exclude<ReturnType<typeof normalize>, null>,
  input: {
    data: Record<string, unknown>;
    bound: Record<string, unknown>;
    signatures: SignatureRender[];
    schema?: FormSchema;
    options?: RenderOptions;
  },
  images: RenderImage[],
  zone: string,
  budget: BudgetLayout,
): unknown {
  const helper = entry.helper ?? "text";
  if (helper === "signedFooter") return signedFooterLine(input.signatures, zone);
  if (helper === "checkbox") return checkbox(read(input, entry.path), entry) ? CHECKED : UNCHECKED;
  if (helper === "signature") return signatureKey(tag, entry, input.signatures, images);
  if (helper === "join") return joinValue(read(input, entry.path), entry.slot);
  if (helper === "choice") return choiceLabel(read(input, entry.path));
  if (helper === "date") {
    const raw = read(input, entry.path);
    if ((raw == null || raw === "") && entry.path) {
      const event = input.signatures.find(
        (item) => item.fieldPath === entry.path || item.fieldPath.startsWith(`${entry.path}.`),
      );
      if (event) return formatDate(event.signedAt, zone);
    }
    return formatDate(raw, zone);
  }
  if (helper === "money") return formatMoney(read(input, entry.path));
  if (helper === "rows") return rowLoop(tag, entry, input, images);
  if (helper === "assessmentRows") return assessmentLoop(entry, input);
  if (helper === "budgetCell") return budgetCell(entry, budget);
  if (helper === "budgetRest") return budgetRest(entry, budget);
  if (helper === "budgetSum") return budgetSum(entry, input.data);
  return display(read(input, entry.path));
}

function read(
  input: { data: Record<string, unknown>; bound: Record<string, unknown> },
  path: string | undefined,
): unknown {
  if (!path) return null;
  if (path.startsWith("protocol.") || path.startsWith("rec.")) {
    if (path in input.bound) return input.bound[path];
  }
  return getPath(input.data, path) ?? input.bound[path] ?? null;
}

function checkbox(value: unknown, entry: { equals?: string; includes?: string }): boolean {
  const expected = entry.equals ?? entry.includes;
  if (!expected) return value === true || value === "YES" || value === "true";
  if (Array.isArray(value)) return value.includes(expected);
  return value === expected;
}

function signatureKey(
  tag: string,
  entry: { path?: string; slot?: number; width?: number; height?: number },
  signatures: SignatureRender[],
  images: RenderImage[],
): string {
  const matches = signatures.filter((item) => !entry.path || item.fieldPath === entry.path || item.fieldPath.startsWith(`${entry.path}.`));
  const chosen = matches[entry.slot ?? 0];
  if (!chosen?.image) return "";
  const key = `${tag}:${entry.slot ?? 0}`;
  images.push({ key, bytes: chosen.image, width: entry.width ?? 160, height: entry.height ?? 48 });
  return key;
}

function joinValue(value: unknown, slot?: number): string {
  if (Array.isArray(value)) {
    if (slot != null) return display(value[slot]);
    return value.map((item) => display(item)).filter(Boolean).join(", ");
  }
  return display(value);
}

function choiceLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => choiceLabel(item)).filter(Boolean).join(", ");
  if (typeof value !== "string" || !value) return "";
  return CHOICE_LABELS[value] ?? value;
}

function formatDate(value: unknown, zone: string): string {
  if (value instanceof Date) return formatInTimeZone(value, zone, "MM/dd/yyyy");
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-");
    return `${month}/${day}/${year}`;
  }
  return display(value);
}

function formatMoney(value: unknown): string {
  if (typeof value !== "number" || !Number.isInteger(value)) return "";
  return formatCentavos(value);
}

function rowLoop(
  tag: string,
  entry: { path?: string; columns?: string[]; width?: number; height?: number },
  input: { data: Record<string, unknown>; bound: Record<string, unknown>; signatures: SignatureRender[] },
  images: RenderImage[],
): Record<string, unknown>[] {
  const value = read(input, entry.path);
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  const columns = entry.columns ?? [];
  return rows.map((row, index) => {
    const item: Record<string, unknown> = {};
    for (const column of columns) {
      if (column === "sig") {
        const event = input.signatures.find((signature) => signature.fieldPath === `${entry.path}.researchers[${index}]`);
        item.sig = putImage(images, `${tag}-${index}`, event?.image ?? null, entry.width ?? 120, entry.height ?? 40);
      } else {
        item[column] = column === "total" || column === "personal" || column === "external" || column === "internal"
          ? formatMoney(row[column]) || display(row[column])
          : display(row[column]);
      }
    }
    return item;
  });
}

function assessmentLoop(
  entry: { path?: string; columns?: string[]; onlyFilled?: string[]; highlightIf?: string },
  input: { data: Record<string, unknown>; bound: Record<string, unknown>; schema?: FormSchema; options?: RenderOptions },
): Record<string, string>[] {
  const field = entry.path && input.schema ? findField(input.schema, entry.path) : undefined;
  const stored = read(input, entry.path);
  const rows = field?.rows ?? objectRows(stored);
  const filled = entry.onlyFilled ?? [];
  const overrides = input.options?.showOriginal === false ? overrideMap(field) : {};
  return rows.flatMap((row) => {
    const cells = cellRecord(stored, row.id);
    if (filled.length > 0 && !filled.some((column) => assessmentCellFilled(effectiveCell(cells, column, overrides)))) return [];
    const mark = Boolean(entry.highlightIf && cells[entry.highlightIf] === true);
    const wrap = (text: string) => (mark && text ? `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}` : text);
    const item: Record<string, string> = {
      code: wrap(row.code),
      label: wrap(row.label),
    };
    for (const column of entry.columns ?? []) {
      if (column === "code" || column === "label") continue;
      const raw = effectiveCell(cells, column, overrides);
      item[column] = wrap(column === "assessment" || column === "answer" || column === "present" ? choiceLabel(raw) : display(raw));
    }
    return [item];
  });
}

function assessmentCellFilled(value: unknown): boolean {
  if (typeof value === "boolean") return value === true;
  return Boolean(display(value));
}

function layoutBudget(data: Record<string, unknown>): BudgetLayout {
  const named = new Map<string, Record<string, unknown> | null>();
  const rest = new Map<string, Record<string, unknown>[]>();
  const plan: Record<string, string[]> = {
    ps: ["salaries", "honoraria"],
    mooe: ["travel", "supplies", "incentive"],
    capital: [],
    admin: [],
  };
  for (const [section, matches] of Object.entries(plan)) {
    const rows = arrayRows(data[section]);
    const used = new Set<number>();
    for (const match of matches) {
      const pattern = BUDGET_MATCH[match];
      const found = pattern
        ? rows.findIndex((row, index) => !used.has(index) && pattern.test(display(row.particular)))
        : -1;
      if (found >= 0) {
        used.add(found);
        named.set(`${section}:${match}`, rows[found] ?? null);
      } else {
        named.set(`${section}:${match}`, null);
      }
    }
    for (const match of matches) {
      if (named.get(`${section}:${match}`)) continue;
      const found = rows.findIndex((_, index) => !used.has(index));
      if (found < 0) continue;
      used.add(found);
      named.set(`${section}:${match}`, rows[found] ?? null);
    }
    rest.set(
      section,
      rows.filter((_, index) => !used.has(index)),
    );
  }
  return { named, rest };
}

function budgetCell(entry: { path?: string; match?: string; column?: string }, budget: BudgetLayout): string {
  const row = budget.named.get(`${entry.path ?? ""}:${entry.match ?? ""}`);
  if (!row || !entry.column) return "";
  if (entry.column === "particular") return display(row.particular);
  return formatMoney(row[entry.column]);
}

function budgetRest(entry: { path?: string; columns?: string[] }, budget: BudgetLayout): Record<string, string>[] {
  const rows = budget.rest.get(entry.path ?? "") ?? [];
  const columns = entry.columns ?? ["particular", "personal", "external", "internal", "total"];
  return rows.map((row) => {
    const item: Record<string, string> = {};
    for (const column of columns) {
      item[column] = column === "particular" ? display(row.particular) : formatMoney(row[column]);
    }
    return item;
  });
}

function budgetSum(entry: { sections?: string[]; column?: string; extraPaths?: string[] }, data: Record<string, unknown>): string {
  const column = entry.column ?? "total";
  let centavos = 0;
  let any = false;
  for (const section of entry.sections ?? []) {
    for (const row of arrayRows(data[section])) {
      const amount = row[column];
      if (typeof amount === "number" && Number.isInteger(amount)) {
        centavos += amount;
        any = true;
      }
    }
  }
  for (const path of entry.extraPaths ?? []) {
    const amount = getPath(data, path);
    if (typeof amount === "number" && Number.isInteger(amount)) {
      centavos += amount;
      any = true;
    }
  }
  return any ? formatCentavos(centavos) : "";
}

function arrayRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function objectRows(stored: unknown): { id: string; code: string; label: string }[] {
  if (!isRecord(stored)) return [];
  return Object.keys(stored).map((id) => ({ id, code: id, label: "" }));
}

function cellRecord(stored: unknown, rowId: string): Record<string, unknown> {
  if (!isRecord(stored)) return {};
  const direct = stored[rowId];
  return isRecord(direct) ? direct : {};
}

function putImage(images: RenderImage[], key: string, bytes: Buffer | null, width: number, height: number): string {
  if (!bytes) return "";
  images.push({ key, bytes, width, height });
  return key;
}

function display(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item) => display(item)).filter(Boolean).join(", ");
  return "";
}

function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  target[key] = value;
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const part of path.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function entryOf(entry: PlaceholderEntry | undefined) {
  return normalize(entry);
}
