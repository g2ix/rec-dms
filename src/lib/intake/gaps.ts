import { SCOPING_KEYS, SCOPING_QUESTIONS, budgetColumnsFor, type IntakeGap, type IntakeValues } from "@/lib/intake/model";

export type ReferencePoint = { form: string; code: string; label: string };

/** The research type also has its own checklist item ("Research type"); the checklist leaves this gap out of the study item. */
export const RESEARCH_TYPE_GAP = "Choose the research type.";

/**
 * What still blocks submission on an intake version. The study fields (on the protocol) count too,
 * because F-27 prints them; the source of funds is its own section because it opens the F-30 columns. Each gap names its section so the intake page can link to it.
 */
export function intakeGaps(input: {
  intake: IntakeValues;
  study: {
    researchTypeCodes: readonly string[];
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    fundingCodes: readonly string[];
  };
  /** Each researcher's agreements and, where the version has F-27 and F-28 copies, their signature on each. */
  researchers: { memberId?: string; name: string; declarationsAt: string | null; consentsAt: string | null; signatures?: ResearcherSignatures }[];
  /** Points the proponent must reference: every point with a page cell that the scoping rules leave applicable. */
  referencePoints: readonly ReferencePoint[];
  /** F-38 on a resubmission: the open points the proponent must answer. */
  actionPoints: readonly { code: string; label: string }[];
}): IntakeGap[] {
  const gaps: IntakeGap[] = [];
  const { intake, study } = input;

  if (study.researchTypeCodes.length === 0) gaps.push({ section: "study", message: RESEARCH_TYPE_GAP });
  if (study.durationMonths == null) gaps.push({ section: "study", message: "Enter the duration in months." });
  if (study.expectedParticipants == null) gaps.push({ section: "study", message: "Enter the expected number of participants." });
  if (!study.studySite.trim()) gaps.push({ section: "study", message: "Enter the study site." });
  if (study.fundingCodes.length === 0) gaps.push({ section: "funding", message: "Choose the source of funds." });

  for (const key of SCOPING_KEYS) {
    if (typeof intake.scoping[key] !== "boolean") gaps.push({ section: "scoping", message: `Answer: ${SCOPING_QUESTIONS[key]}` });
  }
  if (intake.scoping.consentNeeded === false && !intake.scoping.waiverReason?.trim()) {
    gaps.push({ section: "scoping", message: "Say why informed consent is not needed." });
  }

  if (!intake.coi.kind) gaps.push({ section: "coi", message: "Declare whether there is a conflict of interest." });
  if (intake.coi.kind === "SPECIFY" && !intake.coi.text?.trim()) gaps.push({ section: "coi", message: "Specify the conflict of interest." });

  const open = new Set(budgetColumnsFor(study.fundingCodes));
  const lines = intake.budgetLines;
  if (lines.length === 0) gaps.push({ section: "budget", message: "Add at least one budget line." });
  for (const line of lines) {
    const name = line.fee ? "Ethics Review Fee" : line.item.trim() || "A budget line";
    if (!line.fee && !line.item.trim()) gaps.push({ section: "budget", message: "Name every budget item." });
    for (const column of ["personal", "external", "internal"] as const) {
      if ((line[column] ?? 0) > 0 && !open.has(column)) {
        gaps.push({ section: "budget", message: `${name}: the ${column} column is not one of your sources of funds.` });
      }
    }
  }

  const missing = input.referencePoints.filter((point) => {
    const reference = intake.references[point.code];
    if (reference === "NA") return false;
    return !reference || !reference.page.trim() || !reference.line.trim();
  });
  if (missing.length > 0) {
    // The message is a count (the rail and checklist); the codes go in the detail, for the Where to find it table to highlight.
    gaps.push({
      section: "references",
      message: missing.length === 1 ? "1 point still needs a page reference." : `${missing.length} points still need a page reference.`,
      detail: { codes: missing.map((point) => point.code) },
    });
  }

  const unanswered = input.actionPoints.filter((point) => !intake.actions[point.code]?.trim());
  if (unanswered.length > 0) {
    gaps.push({
      section: "actions",
      message:
        unanswered.length <= 3
          ? `Describe the action taken on ${unanswered.map((point) => point.code).join(", ")}.`
          : `${unanswered.length} points still need the action taken.`,
    });
  }

  // One gap per researcher who has not agreed to both and signed both: what the rail and submit count.
  for (const researcher of input.researchers) {
    const message = researcherGap(researcher);
    if (message) gaps.push({ section: "agreements", memberId: researcher.memberId, message });
  }

  return gaps;
}

export type ResearcherSignatures = Partial<Record<"F-27" | "F-28" | "F-38", "signed" | "void" | "unsigned">>;

/** "Ana Cruz still needs to agree to the F-27 declarations, then sign F-27 and F-28." Null when done. */
export function researcherGap(researcher: { name: string; declarationsAt: string | null; consentsAt: string | null; signatures?: ResearcherSignatures }): string | null {
  const agree: string[] = [];
  if (!researcher.declarationsAt) agree.push("agree to the F-27 declarations");
  if (!researcher.consentsAt) agree.push("give the F-28 consents");
  const forms = Object.entries(researcher.signatures ?? {}) as [string, string][];
  const unsigned = forms.filter(([, status]) => status === "unsigned").map(([code]) => code);
  const voided = forms.filter(([, status]) => status === "void").map(([code]) => code);
  const sign: string[] = [];
  if (unsigned.length > 0) sign.push(`sign ${andList(unsigned)}`);
  if (voided.length > 0) sign.push(`sign ${andList(voided)} again`);
  if (agree.length === 0 && sign.length === 0) return null;
  const todo = agree.length > 0 && sign.length > 0 ? `${andList(agree)}, then ${andList(sign)}` : andList([...agree, ...sign]);
  return `${researcher.name} still needs to ${todo}.`;
}

function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
