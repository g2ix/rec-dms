/** Shapes and wording for the "Before you can submit" checklist. The server builds the data; this file only describes it. */

export type ChecklistTab = "account" | "details" | "intake" | "members" | "forms" | "uploads";

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  hint: string | null;
  /** Where the person answers this item. Null when there is nothing for them to do. */
  href: string | null;
};

export type ChecklistGroup = {
  tab: ChecklistTab;
  label: string;
  /** "Open Forms" link target. Null for groups with no tab of their own. */
  href: string | null;
  items: ChecklistItem[];
};

export type SubmissionChecklist = {
  /** The workflow step these requirements come from, e.g. "Submit the initial protocol". */
  stepName: string;
  groups: ChecklistGroup[];
  done: number;
  total: number;
  accountApproved: boolean;
};

export const CHECKLIST_ORDER: ChecklistTab[] = ["account", "details", "members", "forms", "uploads"];

export function groupLeft(group: ChecklistGroup): number {
  return group.items.filter((item) => !item.done).length;
}

export function firstMissing(group: ChecklistGroup): ChecklistItem | null {
  return group.items.find((item) => !item.done) ?? null;
}

/** Missing count per tab, for the count pills on the protocol tabs. Tabs without required items are left out. */
export function tabCounts(checklist: SubmissionChecklist | null): Partial<Record<ChecklistTab, number>> {
  const counts: Partial<Record<ChecklistTab, number>> = {};
  if (!checklist) return counts;
  for (const group of checklist.groups) counts[group.tab] = groupLeft(group);
  return counts;
}

/** "5 items left, and your account needs approval", or "Ready to submit". */
export function submitSummary(checklist: SubmissionChecklist): string {
  const left = checklist.groups
    .filter((group) => group.tab !== "account")
    .reduce((sum, group) => sum + groupLeft(group), 0);
  const items = left === 1 ? "1 item left" : `${left} items left`;
  if (left === 0 && checklist.accountApproved) return "Ready to submit";
  if (left === 0) return "Your account needs approval";
  return checklist.accountApproved ? items : `${items}, and your account needs approval`;
}

export function isReady(checklist: SubmissionChecklist): boolean {
  return checklist.done === checklist.total;
}

export type ActivityEntry = {
  id: string;
  label: string;
  who: string;
  first: Date;
  last: Date;
  count: number;
};

/** Merges consecutive identical events by the same person. Input and output are newest first. */
export function mergeActivity(rows: { id: string; label: string; who: string; at: Date }[]): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const row of rows) {
    const previous = out[out.length - 1];
    if (previous && previous.label === row.label && previous.who === row.who) {
      previous.count += 1;
      previous.first = row.at;
      continue;
    }
    out.push({ id: row.id, label: row.label, who: row.who, first: row.at, last: row.at, count: 1 });
  }
  return out;
}
