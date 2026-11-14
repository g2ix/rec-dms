import { logicIsTrue } from "@/lib/forms/logic";
import type { AssigneeRule, Step, WorkflowGraph } from "@/lib/workflow/graph";

const RETURNED = /^returned/i;

/** A return is an outcome whose transition leads to a Returned status. */
export function returnsToProponent(graph: WorkflowGraph, stepKey: string, outcome: string | null): boolean {
  if (!outcome) return false;
  return graph.transitions.some((transition) => {
    if (transition.from !== stepKey || transition.when == null || !logicIsTrue(transition.when, { outcome })) return false;
    const label = transition.statusLabel ?? graph.steps.find((step) => step.key === transition.to)?.statusLabel;
    return RETURNED.test(label ?? "");
  });
}

/** Outcomes of a step that return the protocol to the proponents. */
export function returnOutcomes(graph: WorkflowGraph, step: Step): string[] {
  return (step.outcomes ?? []).map((item) => item.key).filter((key) => returnsToProponent(graph, step.key, key));
}

/** Steps from the version freeze onward. A graph with no freeze is treated as review from the start. */
export function reviewStepKeys(graph: WorkflowGraph): Set<string> {
  const queue = graph.steps.filter((step) => step.actions?.some((action) => action.kind === "SNAPSHOT_VERSION")).map((step) => step.key);
  if (queue.length === 0) return new Set(graph.steps.map((step) => step.key));
  const seen = new Set(queue);
  for (const key of queue) {
    for (const transition of graph.transitions) {
      if (transition.from !== key || seen.has(transition.to)) continue;
      seen.add(transition.to);
      queue.push(transition.to);
    }
  }
  return seen;
}

/** A release is a step that generates documents. */
export function isReleaseStep(step: Step | undefined): boolean {
  return Boolean(step?.actions?.some((action) => action.kind === "GENERATE_DOCUMENTS"));
}

/** A rule that names the proponents' side: the leader, the proponents or the adviser. */
export function isProponentSideRule(rule: AssigneeRule | undefined): boolean {
  return rule?.kind === "PROTOCOL_LEADER" || rule?.kind === "PROTOCOL_PROPONENTS" || rule?.kind === "PROTOCOL_ADVISER";
}

/**
 * Forms the committee works on during review: any form on a review-stage step that is not the
 * proponents' or the adviser's own step (F-31, F-35/F-36 reviewer copies, F-37, F-38 remarks, F-39…).
 * Read from the graph, so no form code is named here.
 */
export function reviewFormCodes(graph: WorkflowGraph): Set<string> {
  const stage = reviewStepKeys(graph);
  const codes = new Set<string>();
  for (const step of graph.steps) {
    if (!stage.has(step.key) || isProponentSideRule(step.assignee)) continue;
    for (const form of step.forms ?? []) codes.add(form.code);
  }
  return codes;
}
