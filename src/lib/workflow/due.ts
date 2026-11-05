export type DueState = "overdue" | "soon" | "scheduled" | "none";

const SOON_MS = 48 * 60 * 60 * 1000;

export function dueState(dueAt: Date | null, now = new Date()): DueState {
  if (!dueAt) return "none";
  const delta = dueAt.getTime() - now.getTime();
  if (delta < 0) return "overdue";
  if (delta <= SOON_MS) return "soon";
  return "scheduled";
}
