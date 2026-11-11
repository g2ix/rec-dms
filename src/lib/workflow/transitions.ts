import { logicIsTrue } from "@/lib/forms/logic";
import type { CompleteWhen, Step, Transition, WorkflowGraph } from "@/lib/workflow/graph";

export type LogicData = {
  outcome: string | null;
  protocol: {
    id: string;
    reviewType: string | null;
    panelId: string | null;
    status: string;
    code: string | null;
    title: string;
    hasAdviser: boolean;
    /** Review round: the protocol version number, 1 for the initial review. */
    round?: number;
    clientTypeKey?: string | null;
  };
  forms: Record<string, unknown>;
  step: { key: string };
  /** Latest completed outcome for each step on this version. */
  decisions?: Record<string, string | null>;
  /** The earlier instance this one continues, such as the review a resubmission answers. */
  parent?: { decision: string | null; decisions: Record<string, string | null> };
};

export function pickTransition(graph: WorkflowGraph, from: string, data: LogicData): Transition | null {
  const outgoing = graph.transitions
    .filter((transition) => transition.from === from)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  for (const transition of outgoing) {
    if (transition.when == null || logicIsTrue(transition.when, data)) return transition;
  }
  return null;
}

export function stepIsComplete(
  step: Step,
  tasks: { status: string }[],
): boolean {
  const live = tasks.filter((task) => task.status !== "CANCELLED" && task.status !== "REASSIGNED" && task.status !== "DECLINED");
  const done = live.filter((task) => task.status === "COMPLETED").length;
  if (live.length === 0) return false;
  if (step.type === "PARALLEL_TASK") return done >= requiredCompletions(step.parallel?.completeWhen ?? "ALL", live.length);
  return done === live.length;
}

export function requiredCompletions(rule: CompleteWhen, live: number): number {
  if (rule === "ALL") return live;
  if (rule === "ANY") return 1;
  return rule.atLeast;
}

/** True when some path from `from` reaches `to` without treating them as the same step. */
export function reaches(graph: WorkflowGraph, from: string, to: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (key === to) return true;
    for (const transition of graph.transitions) {
      if (transition.from === key) queue.push(transition.to);
    }
  }
  return false;
}

export function unreachableSteps(graph: WorkflowGraph): string[] {
  const seen = new Set<string>();
  const queue = [graph.startStep];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const transition of graph.transitions) {
      if (transition.from === key) queue.push(transition.to);
    }
  }
  return graph.steps.map((step) => step.key).filter((key) => !seen.has(key));
}

export function outcomeMentioned(when: unknown, outcomeKey: string): boolean {
  if (when === outcomeKey) return true;
  if (Array.isArray(when)) return when.some((item) => outcomeMentioned(item, outcomeKey));
  if (when && typeof when === "object") {
    return Object.values(when as Record<string, unknown>).some((item) => outcomeMentioned(item, outcomeKey));
  }
  return false;
}
