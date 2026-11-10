import type { DurationUnit } from "@/lib/workflow/graph";

/** One open task on the step that is now waiting. */
export type NextTask = {
  stepName: string;
  assigneeUserId: string | null;
  /** The name this viewer may see. Empty for a task that shows a role instead. */
  assigneeName: string | null;
  /** Set when the task belongs to a role, so the role is shown and not the holder. */
  roleLabel: string | null;
  dueAt: Date | null;
  deadline: { amount: number; unit: DurationUnit } | null;
};

const UNIT: Record<DurationUnit, [string, string]> = {
  HOURS: ["hour", "hours"],
  CALENDAR_DAYS: ["day", "days"],
  WORKING_DAYS: ["working day", "working days"],
};

export function durationPhrase(deadline: { amount: number; unit: DurationUnit }): string {
  const [one, many] = UNIT[deadline.unit];
  return `${deadline.amount} ${deadline.amount === 1 ? one : many}`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** What a completed task did, worded from the step, its outcome, and where the transition leads. */
export function completionTitle(input: {
  stepName: string;
  outcomeLabel: string | null;
  /** The chosen outcome leads to a Returned status. */
  isReturn: boolean;
  /** The project leader completed the workflow's first step. */
  isSubmission: boolean;
  leaderName: string | null;
  hasComment: boolean;
}): string {
  if (input.isReturn) {
    return `Returned to ${input.leaderName ?? "the project leader"}${input.hasComment ? " with your comment" : ""}.`;
  }
  if (input.isSubmission) return "Protocol submitted.";
  if (input.outcomeLabel) return `${input.stepName}: ${input.outcomeLabel}.`;
  return `Completed: ${input.stepName}.`;
}

/**
 * "REC Staff acts next: Screen the submission, within 2 days (by 12 Nov 2026)."
 * Reads only the open tasks, so the step, the actor, and the deadline are the workflow's own.
 */
export function nextStepSentence(tasks: NextTask[], viewerId: string, formatDate: (date: Date) => string): string | null {
  const first = tasks[0];
  if (!first) return null;
  const step = tasks.filter((task) => task.stepName === first.stepName);
  const names: string[] = [];
  let viewer = false;
  for (const task of step) {
    if (task.assigneeUserId === viewerId && !task.roleLabel) {
      viewer = true;
      continue;
    }
    const name = task.roleLabel ?? task.assigneeName;
    if (name && !names.includes(name)) names.push(name);
  }
  const who = viewer ? ["You", ...names] : names;
  const due = step.find((task) => task.dueAt)?.dueAt ?? null;
  let when = "";
  if (first.deadline) {
    when = `, within ${durationPhrase(first.deadline)}${due ? ` (by ${formatDate(due)})` : ""}`;
  } else if (due) {
    when = `, by ${formatDate(due)}`;
  }
  if (who.length === 0) return `Next step: ${first.stepName}${when}.`;
  const verb = who.length === 1 && !viewer ? "acts" : "act";
  return `${joinNames(who)} ${verb} next: ${first.stepName}${when}.`;
}
