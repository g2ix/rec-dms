import { parseGraph, type WorkflowGraph } from "@/lib/workflow/graph";
import { outcomeMentioned, reaches, unreachableSteps } from "@/lib/workflow/transitions";

export type GraphIssue = { stepKey?: string; message: string };

const HUMAN = new Set(["TASK", "PARALLEL_TASK", "DECISION", "SIGNATURE", "WAIT_PROPONENT"]);

/**
 * Structural checks on top of the Zod graph. `publishedFormCodes` is the set of
 * form codes that have a published definition. Pass null to skip that check.
 */
export function validateGraph(input: unknown, publishedFormCodes: ReadonlySet<string> | null = null): GraphIssue[] {
  const parsed = parseGraph(input);
  if (!parsed.ok) return [{ message: parsed.message }];
  return structuralIssues(parsed.graph, publishedFormCodes);
}

export function structuralIssues(graph: WorkflowGraph, publishedFormCodes: ReadonlySet<string> | null): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byKey = new Map<string, WorkflowGraph["steps"][number]>();
  for (const step of graph.steps) {
    if (byKey.has(step.key)) issues.push({ stepKey: step.key, message: `Step “${step.key}” is listed more than once.` });
    byKey.set(step.key, step);
  }
  if (!byKey.has(graph.startStep)) {
    issues.push({ message: `The start step “${graph.startStep}” is not in the graph.` });
  }

  for (const transition of graph.transitions) {
    if (!byKey.has(transition.from)) {
      issues.push({ message: `A transition leaves “${transition.from}”, which is not a step.` });
    }
    if (!byKey.has(transition.to)) {
      issues.push({ message: `A transition enters “${transition.to}”, which is not a step.` });
    }
  }

  for (const step of graph.steps) {
    const outgoing = graph.transitions.filter((transition) => transition.from === step.key);
    if (step.type !== "END" && outgoing.length === 0) {
      issues.push({ stepKey: step.key, message: `“${step.name}” has no way out.` });
    }
    if (step.type === "END" && step.assignee) {
      issues.push({ stepKey: step.key, message: `“${step.name}” is an end step and cannot have an assignee.` });
    }
    if (step.type === "AUTO" && step.assignee) {
      issues.push({ stepKey: step.key, message: `“${step.name}” runs by itself and cannot have an assignee.` });
    }
    if (HUMAN.has(step.type) && step.type !== "WAIT_PROPONENT" && !step.assignee) {
      issues.push({ stepKey: step.key, message: `“${step.name}” needs an assignee.` });
    }
    if (step.type === "WAIT_PROPONENT" && !step.deadline) {
      issues.push({ stepKey: step.key, message: `“${step.name}” waits on the proponent and needs a deadline.` });
    }
    if (step.type === "PARALLEL_TASK" && !step.parallel) {
      issues.push({ stepKey: step.key, message: `“${step.name}” needs a rule for when the parallel tasks are done.` });
    }
    if (step.type === "DECISION") {
      const outcomes = step.outcomes ?? [];
      if (outcomes.length === 0) {
        issues.push({ stepKey: step.key, message: `“${step.name}” is a decision and needs outcomes.` });
      }
      const unconditional = outgoing.some((transition) => transition.when == null);
      if (!unconditional) {
        for (const outcome of outcomes) {
          const covered = outgoing.some((transition) => outcomeMentioned(transition.when, outcome.key));
          if (!covered) {
            issues.push({
              stepKey: step.key,
              message: `“${step.name}” has no transition for the outcome “${outcome.label}”.`,
            });
          }
        }
      }
    }
    if (step.assignReviewers?.max != null && step.assignReviewers.min > step.assignReviewers.max) {
      issues.push({ stepKey: step.key, message: `“${step.name}” asks for more reviewers than it allows.` });
    }
    if (step.assignee?.kind === "ASSIGNED_IN_STEP" && step.assignee.source !== "parent") {
      const earlier = byKey.get(step.assignee.stepKey);
      if (!earlier) {
        issues.push({ stepKey: step.key, message: `“${step.name}” uses reviewers from “${step.assignee.stepKey}”, which is not a step.` });
      } else if (!earlier.assignReviewers) {
        issues.push({
          stepKey: step.key,
          message: `“${step.name}” uses reviewers from “${earlier.name}”, but that step does not assign reviewers.`,
        });
      } else if (!reaches(graph, earlier.key, step.key) || earlier.key === step.key) {
        issues.push({
          stepKey: step.key,
          message: `“${step.name}” uses reviewers from “${earlier.name}”, which is not an earlier step.`,
        });
      }
    }
    for (const form of step.forms ?? []) {
      if (publishedFormCodes && !publishedFormCodes.has(form.code)) {
        issues.push({ stepKey: step.key, message: `“${step.name}” uses form ${form.code}, which has no published version.` });
      }
    }
  }

  for (const key of unreachableSteps(graph)) {
    issues.push({ stepKey: key, message: `“${byKey.get(key)?.name ?? key}” cannot be reached from the start.` });
  }
  return issues;
}
