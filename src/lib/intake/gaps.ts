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
  researchers: { name: string; declarationsAt: string | null; consentsAt: string | null }[];
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
    gaps.push({
      section: "references",
      message: `Give the page and line, or NA, for ${missing.length === 1 ? "point" : "points"} ${missing.map((point) => `${point.form} ${point.code}`).join(", ")}.`,
    });
  }

  const unanswered = input.actionPoints.filter((point) => !intake.actions[point.code]?.trim());
  if (unanswered.length > 0) {
    gaps.push({ section: "actions", message: `Describe the action taken on ${unanswered.map((point) => point.code).join(", ")}.` });
  }

  const notDeclared = input.researchers.filter((researcher) => !researcher.declarationsAt).map((researcher) => researcher.name);
  if (notDeclared.length > 0) gaps.push({ section: "agreements", message: `Still to agree to the F-27 declarations: ${notDeclared.join(", ")}.` });
  const notConsented = input.researchers.filter((researcher) => !researcher.consentsAt).map((researcher) => researcher.name);
  if (notConsented.length > 0) gaps.push({ section: "agreements", message: `Still to agree to the F-28 consents: ${notConsented.join(", ")}.` });

  return gaps;
}
