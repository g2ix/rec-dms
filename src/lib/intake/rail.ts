import type { ChecklistItem, SubmissionChecklist } from "@/lib/protocols/checklist";

/**
 * The sections of the single-glance Intake page, in rail order. Each section's status is the
 * submission checklist's items mapped onto it, so the rail and the submit check never disagree:
 * every checklist item except the account belongs to exactly one section.
 */
export type RailKey = "actions" | "study" | "team" | "funding" | "participants" | "coi" | "references" | "documents" | "sign";

export const RAIL_LABELS: Record<RailKey, string> = {
  actions: "Actions taken",
  study: "Study",
  team: "Team",
  funding: "Funding and budget",
  participants: "Participants & consent",
  coi: "Conflict of interest",
  references: "Where to find it",
  documents: "Documents",
  sign: "Agree and sign",
};

/** Rail order. "Actions taken" comes first and only on a revision (version 2 and later). */
export const RAIL_ORDER: readonly RailKey[] = ["actions", "study", "team", "funding", "participants", "coi", "references", "documents", "sign"];

/** Which section answers a checklist item. Null for items that are not answered on the page (the account). */
export function railSectionOf(itemKey: string): RailKey | null {
  if (itemKey === "account.approved" || itemKey.startsWith("account.")) return null;
  if (itemKey === "details.funding" || itemKey === "intake.budget" || itemKey === "forms.F-30") return "funding";
  if (itemKey.startsWith("details.")) return "study";
  if (itemKey.startsWith("members.")) return "team";
  if (itemKey === "intake.scoping") return "participants";
  if (itemKey === "intake.coi") return "coi";
  if (itemKey === "intake.references" || itemKey === "forms.F-35" || itemKey === "forms.F-36") return "references";
  if (itemKey === "intake.actions" || itemKey === "forms.F-38" || itemKey.startsWith("revision.")) return "actions";
  if (itemKey.startsWith("uploads.")) return "documents";
  // The agreements, the F-27 and F-28 signatures, and any other required form the proponents complete.
  return "sign";
}

export type RailSection = { key: RailKey; label: string; missing: ChecklistItem[]; total: number };

/**
 * The rail's sections with their missing checklist items. `actions` is shown only on a revision.
 * Sections with no checklist items (Team, usually) show as done.
 */
export function railSections(checklist: SubmissionChecklist | null, options: { revision: boolean }): RailSection[] {
  const items = (checklist?.groups ?? []).flatMap((group) => group.items);
  return RAIL_ORDER.filter((key) => key !== "actions" || options.revision).map((key) => {
    const mine = items.filter((item) => railSectionOf(item.key) === key);
    return { key, label: RAIL_LABELS[key], missing: mine.filter((item) => !item.done), total: mine.length };
  });
}

/** The checklist's missing items the page can answer, in checklist order: what "N items left" counts. */
export function missingOnPage(checklist: SubmissionChecklist | null): ChecklistItem[] {
  return (checklist?.groups ?? []).flatMap((group) => group.items).filter((item) => !item.done && railSectionOf(item.key) !== null);
}

/** Short one-line intros shown above each step. */
export const STEP_INTROS: Record<RailKey, string> = {
  actions: "Say what you changed for each point the panel flagged.",
  study: "These print on every REC form. Answers save as you type.",
  team: "Everyone on this protocol. Each researcher agrees and signs on their own account.",
  funding: "Your sources of funds open the columns of the F-30 budget.",
  participants: "A no marks the points that only apply otherwise as N/A.",
  coi: "Declare any conflict of interest for F-27.",
  references: "Where each assessment point is in your proposal and consent form.",
  documents: "Upload the files this version needs.",
  sign: "Each researcher agrees, then signs once (F-27 and F-28, or F-38 on a revision).",
};

/**
 * The step a link opens. Older links (the checklist, the preview) name a part of a step:
 * #scoping is in Participants, #budget in Funding, #agreements in Agree and sign.
 */
export function stepOfHash(hash: string, steps: readonly RailKey[]): RailKey | "preview" | null {
  const key = hash.replace(/^#/, "");
  if (key === "preview") return "preview";
  const alias: Record<string, RailKey> = { scoping: "participants", budget: "funding", agreements: "sign" };
  const step = (alias[key] ?? key) as RailKey;
  return steps.includes(step) ? step : null;
}

/** The first section with something missing, in rail order, for the submit bar's link. */
export function firstMissingSection(sections: readonly RailSection[]): RailKey | null {
  return sections.find((section) => section.missing.length > 0)?.key ?? null;
}

/**
 * Where a bound value of a generated form is answered on the Intake page. Values nobody types
 * (protocol code, version label, submission date) and profile values (contacts, emails) have none.
 */
export function railSectionOfBinding(bind: string): RailKey | null {
  if (bind === "intake.references") return "references";
  if (bind === "intake.actions") return "actions";
  if (bind.startsWith("protocol.funding") || bind.startsWith("intake.budget")) return "funding";
  if (bind === "protocol.researchers" || bind.startsWith("team.")) return "team";
  if (bind.startsWith("intake.scoping")) return "participants";
  if (bind.startsWith("intake.coi")) return "coi";
  if (bind === "intake.declarations" || bind === "intake.consents") return "sign";
  if (
    bind === "protocol.title" ||
    bind === "protocol.institution" ||
    bind === "protocol.institutionAddress" ||
    bind.startsWith("protocol.researchType") ||
    bind === "protocol.durationMonths" ||
    bind === "protocol.expectedParticipants" ||
    bind === "protocol.studySite"
  ) {
    return "study";
  }
  return null;
}
