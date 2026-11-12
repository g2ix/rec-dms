import { z } from "zod";

/**
 * The intake: what the proponents answer once per protocol version. The study details (title,
 * institution, address, research type, duration, participants, site and funding) stay on the
 * protocol (the Details page); the intake holds the rest. F-27, F-28, F-30 and the proponent
 * columns of F-35, F-36 and F-38 are printed from both.
 */

export const SCOPING_KEYS = [
  "consentNeeded",
  "minors",
  "vulnerable",
  "focusGroups",
  "onlineConsent",
  "nonEnglishIcf",
  "facultyInitiated",
  "personalData",
] as const;
export type ScopingKey = (typeof SCOPING_KEYS)[number];

/** The questions as the proponent reads them. Each answer is yes or no. */
export const SCOPING_QUESTIONS: Record<ScopingKey, string> = {
  consentNeeded: "Will you seek the informed consent of the participants?",
  minors: "Will any participant be a minor (under 18)?",
  vulnerable: "Will the study involve vulnerable participants?",
  focusGroups: "Will you hold focus group discussions?",
  onlineConsent: "Will consent be given online or electronically?",
  nonEnglishIcf: "Is the primary language of any participant other than English, so a translated ICF is appended?",
  facultyInitiated: "Is this a faculty-initiated study?",
  personalData: "Will the study collect or process personal or sensitive data?",
};

const yesNo = z.boolean().nullable().optional();

export const scopingSchema = z
  .object({
    consentNeeded: yesNo,
    /** Why consent is not needed, when consentNeeded is false. */
    waiverReason: z.string().max(4000).optional(),
    minors: yesNo,
    vulnerable: yesNo,
    focusGroups: yesNo,
    onlineConsent: yesNo,
    nonEnglishIcf: yesNo,
    facultyInitiated: yesNo,
    personalData: yesNo,
  })
  .strict();
export type Scoping = z.infer<typeof scopingSchema>;

export const coiSchema = z
  .object({
    kind: z.enum(["NONE", "SPECIFY"]).nullable().optional(),
    text: z.string().max(4000).optional(),
  })
  .strict();
export type Coi = z.infer<typeof coiSchema>;

export const BUDGET_SECTIONS = ["PS", "MOOE", "CAPITAL", "ADMIN"] as const;
export type BudgetSection = (typeof BUDGET_SECTIONS)[number];
export const BUDGET_COLUMNS = ["personal", "external", "internal"] as const;
export type BudgetColumn = (typeof BUDGET_COLUMNS)[number];

export const BUDGET_SECTION_LABELS: Record<BudgetSection, string> = {
  PS: "I. Personnel Services (PS)",
  MOOE: "II. Maintenance and Other Operating Expenses (MOOE)",
  CAPITAL: "III. Capital Outlay",
  ADMIN: "IV. Administrative Cost",
};

/** The F-30 sub-items, offered as a guide. The proponent can rename or add items. */
export const BUDGET_ITEM_GUIDE: Record<BudgetSection, string[]> = {
  PS: ["Salaries", "Honoraria"],
  MOOE: ["Traveling expenses", "Supplies and materials expenses", "Incentive for the respondent"],
  CAPITAL: [],
  ADMIN: [],
};

const centavos = z.number().int().min(0).max(100_000_000_000).nullable().optional();

export const budgetLineSchema = z
  .object({
    id: z.string().min(1).max(64),
    section: z.enum(BUDGET_SECTIONS),
    item: z.string().max(500),
    personal: centavos,
    external: centavos,
    internal: centavos,
    /** The Ethics Review Fee line. Its amount starts from the fee schedule; the proponent picks the column. */
    fee: z.boolean().optional(),
  })
  .strict();
export type BudgetLine = z.infer<typeof budgetLineSchema>;
export const budgetLinesSchema = z.array(budgetLineSchema).max(200);

/** A page and line reference into the manuscript, or "NA" when the point does not apply. */
export const referenceSchema = z.union([
  z.literal("NA"),
  z
    .object({
      page: z.string().max(20),
      line: z.string().max(20),
    })
    .strict(),
]);
export type Reference = z.infer<typeof referenceSchema>;
export const referencesSchema = z.record(z.string().min(1).max(20), referenceSchema);
export type References = z.infer<typeof referencesSchema>;

/** F-38: what the proponent did on each open point, with page and paragraph. Keyed by point code. */
export const actionsSchema = z.record(z.string().min(1).max(20), z.string().max(8000));
export type Actions = z.infer<typeof actionsSchema>;

export type IntakeSection = "scoping" | "coi" | "budget" | "references" | "actions";
export const INTAKE_SECTIONS: readonly IntakeSection[] = ["scoping", "coi", "budget", "references", "actions"];

export type IntakeValues = {
  scoping: Scoping;
  coi: Coi;
  budgetLines: BudgetLine[];
  references: References;
  actions: Actions;
};

export function emptyIntake(): IntakeValues {
  return { scoping: {}, coi: {}, budgetLines: [], references: {}, actions: {} };
}

function parsed<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** Reads stored JSON, dropping anything that no longer fits the shape rather than failing the page. */
export function readIntake(row: {
  scoping?: unknown;
  coi?: unknown;
  budgetLines?: unknown;
  references?: unknown;
  actions?: unknown;
} | null): IntakeValues {
  if (!row) return emptyIntake();
  return {
    scoping: parsed(scopingSchema, row.scoping, {}),
    coi: parsed(coiSchema, row.coi, {}),
    budgetLines: parsed(budgetLinesSchema, row.budgetLines, []),
    references: parsed(referencesSchema, row.references, {}),
    actions: parsed(actionsSchema, row.actions, {}),
  };
}

export function formatReference(reference: Reference | undefined): string {
  if (!reference) return "";
  if (reference === "NA") return "NA";
  const page = reference.page.trim();
  const line = reference.line.trim();
  if (!page && !line) return "";
  return `p. ${page || "__"}, line ${line || "__"}`;
}

export function lineTotal(line: Pick<BudgetLine, BudgetColumn>): number {
  return BUDGET_COLUMNS.reduce((sum, column) => sum + (line[column] ?? 0), 0);
}

/** Which F-30 columns the ticked sources of funds open. Researcher-funded opens Personal only. */
export function budgetColumnsFor(fundingCodes: readonly string[]): BudgetColumn[] {
  const open = new Set<BudgetColumn>();
  if (fundingCodes.includes("RESEARCHER")) open.add("personal");
  if (fundingCodes.includes("AGENCY") || fundingCodes.includes("OTHER")) open.add("external");
  if (fundingCodes.includes("INSTITUTION")) open.add("internal");
  return BUDGET_COLUMNS.filter((column) => open.has(column));
}

export type IntakeGap = { section: IntakeSection | "study" | "agreements"; message: string };
