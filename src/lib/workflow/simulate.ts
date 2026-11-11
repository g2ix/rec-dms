import { logicIsTrue } from "@/lib/forms/logic";
import { addDuration } from "@/lib/workflow/calendar";
import { releaseItemKey, ruleChain, slotsOf, type AssigneeRule, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { pickTransition, type LogicData } from "@/lib/workflow/transitions";

export type SimulationChoice = { stepKey: string; outcome?: string | null };

export type SimulationStop = {
  stepKey: string;
  name: string;
  dueAt: string | null;
  outcome: string | null;
  /** What this step does beyond its name: assignee chain, reviewer slots, timeout, bill, release. */
  notes: string[];
};

export type SimulationFacts = { reviewType?: string | null; round?: number; parentDecision?: string | null; hasAdviser?: boolean };

/**
 * Walks a graph from the start, applying the choices in order.
 * Stops when it needs an outcome that was not supplied, when it ends, or after 40 steps. A step
 * with an outcome for a passed deadline takes that outcome when no choice is given.
 */
export function simulateGraph(
  graph: WorkflowGraph,
  choices: SimulationChoice[],
  holidays: ReadonlySet<string>,
  start: Date,
  facts: SimulationFacts = {},
): { stops: SimulationStop[]; error: string | null } {
  const stops: SimulationStop[] = [];
  let cursor = graph.startStep;
  let now = start;
  const pending = [...choices];
  const state: SimulationState = { reviewType: facts.reviewType ?? null, decisions: {} };
  for (let guard = 0; guard < 40; guard += 1) {
    const step = graph.steps.find((item) => item.key === cursor);
    if (!step) return { stops, error: `The step “${cursor}” is not in the graph.` };
    const dueAt = step.deadline ? addDuration(now, step.deadline.amount, step.deadline.unit, holidays) : null;
    const notes = stepNotes(graph, step);
    if (step.type === "END") {
      stops.push({ stepKey: step.key, name: step.name, dueAt: null, outcome: null, notes });
      return { stops, error: null };
    }
    if (step.type === "AUTO") {
      stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome: null, notes });
      applyValues(step, null, state, facts);
      const next = pickTransition(graph, step.key, dataFor(step.key, null, state, facts));
      if (!next) return { stops, error: `“${step.name}” has no matching transition.` };
      cursor = next.to;
      continue;
    }
    const choice = pending[0]?.stepKey === step.key ? pending.shift() : undefined;
    const needsOutcome = step.type === "DECISION" || ((step.outcomes?.length ?? 0) > 0 && step.type !== "WAIT_PROPONENT");
    const outcome = choice?.outcome ?? (needsOutcome ? (step.onTimeout?.outcome ?? null) : null);
    if (needsOutcome && !outcome) {
      stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome: null, notes });
      return { stops, error: null };
    }
    if (!choice?.outcome && outcome) notes.push(`No choice given: the deadline passes and the system records ${outcome}.`);
    stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome, notes });
    if (outcome) state.decisions[step.key] = outcome;
    applyValues(step, outcome, state, facts);
    const next = pickTransition(graph, step.key, dataFor(step.key, outcome, state, facts));
    if (!next) return { stops, error: `“${step.name}” has no matching transition.` };
    now = dueAt ?? now;
    cursor = next.to;
  }
  return { stops, error: "The simulation stopped after 40 steps." };
}

/** True when the simulation is waiting for a choice at its last stop. */
export function waitingForChoice(graph: WorkflowGraph, stop: SimulationStop | undefined): Step | null {
  if (!stop || stop.outcome) return null;
  const step = graph.steps.find((item) => item.key === stop.stepKey);
  if (!step || step.type === "END" || step.type === "AUTO") return null;
  return (step.outcomes?.length ?? 0) > 0 ? step : null;
}

/** Review type and each step's chosen outcome so far, as the engine reads them on a transition. */
type SimulationState = { reviewType: string | null; decisions: Record<string, string | null> };

function applyValues(step: Step, outcome: string | null, state: SimulationState, facts: SimulationFacts) {
  // Conditions are read before any field of this step changes, as the engine does.
  const data = dataFor(step.key, outcome, state, facts);
  for (const field of step.setFields ?? []) {
    if (field.path !== "protocol.reviewType") continue;
    if (field.when != null && !logicIsTrue(field.when, data)) continue;
    const value = field.from === "outcome" ? outcome : field.from === "value" ? (field.value ?? null) : null;
    if (value === "EXEMPT" || value === "EXPEDITED" || value === "FULL") state.reviewType = value;
  }
}

function ruleText(rule: AssigneeRule): string {
  if (rule.kind === "FIRST_AVAILABLE") return `first available of ${rule.rules.map(ruleText).join(" → ")}`;
  if (rule.kind === "ROLE") return rule.role;
  if (rule.kind === "PANEL_ROLE_OF_PROTOCOL") return `${rule.role} of the panel`;
  if (rule.kind === "ASSIGNED_IN_STEP") return `reviewers from ${rule.stepKey}`;
  if (rule.kind === "USER") return "a named person";
  return rule.kind.toLowerCase().replaceAll("_", " ");
}

function stepNotes(graph: WorkflowGraph, step: Step): string[] {
  const notes: string[] = [];
  if (step.assignee) notes.push(`Assignee: ${ruleText(step.assignee)}${ruleChain(step.assignee).length > 1 ? " (skips members and declared conflicts)" : ""}.`);
  for (const slot of slotsOf(step)) {
    const attrs = Object.entries(slot.eligible?.attributes ?? {}).map(([key, value]) => `${key}=${String(value)}`).join(", ");
    notes.push(`Slot ${slot.label}${slot.eligible?.roles?.length ? ` from ${slot.eligible.roles.join(", ")}` : ""}${attrs ? ` with ${attrs}` : ""}${slot.forms?.length ? `, fills ${slot.forms.join(", ")}` : ""}.`);
  }
  const slotForms = (step.forms ?? []).filter((form) => form.slot);
  if (slotForms.length > 0) notes.push(`Forms by slot: ${slotForms.map((form) => `${form.code} → ${form.slot}`).join(", ")}.`);
  if (step.onTimeout) notes.push(`If the deadline passes: ${step.onTimeout.outcome}.`);
  if (step.decline) notes.push(`${step.decline.outcome} opens a re-designation for ${ruleText(step.decline.redesignateBy)}; only that slot changes.`);
  if (step.capture?.noteToReviewers || step.capture?.reviewDueDate) notes.push("Records a note and due date for the reviewers.");
  for (const action of step.actions ?? []) {
    if (action.kind === "ISSUE_BILL") notes.push(`Issues a bill (${typeof action.params?.basis === "string" ? action.params.basis : "reviewType"}). The review does not wait for payment.`);
    if (action.kind === "REOPEN_VERSION") notes.push("Reopens the frozen version for correction under the same number.");
  }
  if (step.feeVerifiedOutcomes?.length) notes.push(`Fee checked for ${step.feeVerifiedOutcomes.join(", ")}${step.feeOverride ? "; REC Staff may override with a reason" : ""}.`);
  for (const [decision, pack] of Object.entries(step.release ?? {})) {
    notes.push(`Release ${decision}: send ${(pack.send ?? []).map(releaseItemKey).join(", ") || "nothing"}; keep ${(pack.keep ?? []).map(releaseItemKey).join(", ") || "nothing"}.`);
  }
  for (const field of step.setFields ?? []) {
    if (field.from === "value") notes.push(`Sets ${field.path} to ${field.value}${field.when ? " when its condition holds" : ""}.`);
  }
  void graph;
  return notes;
}

function dataFor(stepKey: string, outcome: string | null, state: SimulationState, facts: SimulationFacts): LogicData {
  return {
    outcome,
    protocol: {
      id: "simulate",
      reviewType: state.reviewType,
      panelId: null,
      status: "DRAFT",
      code: null,
      title: "Simulation",
      hasAdviser: facts.hasAdviser ?? true,
      round: facts.round ?? 1,
    },
    forms: {},
    step: { key: stepKey },
    decisions: { ...state.decisions },
    parent: { decision: facts.parentDecision ?? null, decisions: {} },
  };
}
