import { addDuration } from "@/lib/workflow/calendar";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { pickTransition, type LogicData } from "@/lib/workflow/transitions";

export type SimulationChoice = { stepKey: string; outcome?: string | null };

export type SimulationStop = {
  stepKey: string;
  name: string;
  dueAt: string | null;
  outcome: string | null;
};

/**
 * Walks a graph from the start, applying the choices in order.
 * Stops when it needs an outcome that was not supplied, when it ends, or after 24 steps.
 */
export function simulateGraph(
  graph: WorkflowGraph,
  choices: SimulationChoice[],
  holidays: ReadonlySet<string>,
  start: Date,
): { stops: SimulationStop[]; error: string | null } {
  const stops: SimulationStop[] = [];
  let cursor = graph.startStep;
  let now = start;
  const pending = [...choices];
  for (let guard = 0; guard < 24; guard += 1) {
    const step = graph.steps.find((item) => item.key === cursor);
    if (!step) return { stops, error: `The step “${cursor}” is not in the graph.` };
    const dueAt = step.deadline ? addDuration(now, step.deadline.amount, step.deadline.unit, holidays) : null;
    if (step.type === "END") {
      stops.push({ stepKey: step.key, name: step.name, dueAt: null, outcome: null });
      return { stops, error: null };
    }
    if (step.type === "AUTO") {
      stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome: null });
      const next = pickTransition(graph, step.key, dataFor(step.key, null));
      if (!next) return { stops, error: `“${step.name}” has no matching transition.` };
      cursor = next.to;
      continue;
    }
    const choice = pending[0]?.stepKey === step.key ? pending.shift() : undefined;
    if (step.type === "DECISION" && !choice?.outcome) {
      stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome: null });
      return { stops, error: null };
    }
    const outcome = choice?.outcome ?? null;
    stops.push({ stepKey: step.key, name: step.name, dueAt: dueAt?.toISOString() ?? null, outcome });
    const next = pickTransition(graph, step.key, dataFor(step.key, outcome));
    if (!next) return { stops, error: `“${step.name}” has no matching transition.` };
    now = dueAt ?? now;
    cursor = next.to;
  }
  return { stops, error: "The simulation stopped after 24 steps." };
}

function dataFor(stepKey: string, outcome: string | null): LogicData {
  return {
    outcome,
    protocol: { id: "simulate", reviewType: null, panelId: null, status: "DRAFT", code: null, title: "Simulation", hasAdviser: true },
    forms: {},
    step: { key: stepKey },
  };
}
