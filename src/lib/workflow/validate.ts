import { parseGraph, releaseItemKey, ruleChain, slotsOf, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
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
    if (step.assignReviewers?.max != null && step.assignReviewers.min != null && step.assignReviewers.min > step.assignReviewers.max) {
      issues.push({ stepKey: step.key, message: `“${step.name}” asks for more reviewers than it allows.` });
    }
    issues.push(...newFieldIssues(graph, step, byKey, publishedFormCodes));
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

const REVIEW_TYPES = new Set(["EXEMPT", "EXPEDITED", "FULL"]);

/** Checks for the fields added in M13: slots, timeouts, declines, fees, release packages, set values, actions. */
function newFieldIssues(
  graph: WorkflowGraph,
  step: Step,
  byKey: Map<string, Step>,
  publishedFormCodes: ReadonlySet<string> | null,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (message: string) => issues.push({ stepKey: step.key, message });
  const outcomes = new Set((step.outcomes ?? []).map((item) => item.key));
  const slots = slotsOf(step);
  const slotKeys = new Set<string>();
  for (const slot of slots) {
    if (slotKeys.has(slot.key)) add(`“${step.name}” lists the reviewer slot “${slot.key}” more than once.`);
    slotKeys.add(slot.key);
    for (const code of slot.forms ?? []) {
      if (publishedFormCodes && !publishedFormCodes.has(code)) add(`The ${slot.label} slot on “${step.name}” uses form ${code}, which has no published version.`);
    }
  }
  if (step.assignee) {
    for (const rule of ruleChain(step.assignee)) {
      if (step.assignee.kind === "FIRST_AVAILABLE" && rule.kind === "ASSIGNED_IN_STEP") {
        add(`“${step.name}” falls back to reviewers, which a fallback chain cannot use.`);
      }
    }
  }
  const source = step.assignee?.kind === "ASSIGNED_IN_STEP" ? byKey.get(step.assignee.stepKey) : undefined;
  const sourceSlots = new Set(slotsOf(source).map((slot) => slot.key));
  for (const form of step.forms ?? []) {
    if (!form.slot) continue;
    if (!source) add(`“${step.name}” limits ${form.code} to a slot, but its tasks are not for assigned reviewers.`);
    else if (!sourceSlots.has(form.slot)) add(`“${step.name}” limits ${form.code} to the slot “${form.slot}”, which “${source.name}” does not have.`);
  }
  if (step.onTimeout) {
    if (!step.deadline) add(`“${step.name}” has an outcome for a passed deadline but no deadline.`);
    if (!outcomes.has(step.onTimeout.outcome)) add(`“${step.name}” times out to “${step.onTimeout.outcome}”, which is not one of its outcomes.`);
  }
  if (step.decline) {
    if (!outcomes.has(step.decline.outcome)) add(`“${step.name}” declines with “${step.decline.outcome}”, which is not one of its outcomes.`);
    if (step.assignee?.kind !== "ASSIGNED_IN_STEP") add(`“${step.name}” can be declined only when its tasks are for assigned reviewers.`);
  }
  if (step.feeOverride && !step.feeVerifiedOutcomes?.length) add(`“${step.name}” allows a fee override but checks no outcome against the fee.`);
  for (const outcome of step.feeVerifiedOutcomes ?? []) {
    if (outcomes.size > 0 && !outcomes.has(outcome)) add(`“${step.name}” checks the fee for “${outcome}”, which is not one of its outcomes.`);
  }
  if ((step.capture?.noteToReviewers || step.capture?.reviewDueDate) && !step.assignReviewers) {
    add(`“${step.name}” records a note for reviewers but does not assign reviewers.`);
  }
  for (const [decision, pack] of Object.entries(step.release ?? {})) {
    for (const item of [...(pack.send ?? []), ...(pack.keep ?? [])]) {
      const key = releaseItemKey(item);
      const code = key.startsWith("certificate:") ? key.slice("certificate:".length) : key;
      if (!code) add(`“${step.name}” releases an empty item for ${decision}.`);
      else if (publishedFormCodes && !key.startsWith("certificate:") && !publishedFormCodes.has(code)) {
        add(`“${step.name}” releases form ${code} for ${decision}, which has no published version.`);
      }
    }
  }
  for (const field of step.setFields ?? []) {
    if (field.from === "value" && !field.value) add(`“${step.name}” sets ${field.path} from a fixed value but gives none.`);
    if (field.from === "value" && field.path === "protocol.reviewType" && field.value && !REVIEW_TYPES.has(field.value)) {
      add(`“${step.name}” sets the review type to “${field.value}”. Use EXEMPT, EXPEDITED, or FULL.`);
    }
  }
  for (const action of step.actions ?? []) {
    if (action.kind === "ISSUE_BILL" && action.params?.basis != null && typeof action.params.basis !== "string") {
      add(`“${step.name}” issues a bill with a basis that is not text.`);
    }
    if (action.kind === "REOPEN_VERSION") {
      const forms = action.params?.forms;
      if (forms != null && (!Array.isArray(forms) || forms.some((item) => typeof item !== "string"))) {
        add(`“${step.name}” reopens a version with a form list that is not a list of codes.`);
      }
    }
  }
  void graph;
  return issues;
}
