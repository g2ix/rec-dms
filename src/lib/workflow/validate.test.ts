import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { simulateGraph } from "@/lib/workflow/simulate";
import { validateGraph } from "@/lib/workflow/validate";

const base: WorkflowGraph = {
  startStep: "submit",
  steps: [
    { key: "submit", name: "Submit", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
    {
      key: "screen",
      name: "Screen",
      type: "DECISION",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      outcomes: [
        { key: "ACCEPT", label: "Accept" },
        { key: "RETURN", label: "Return" },
      ],
      assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 2, max: 2 },
    },
    {
      key: "review",
      name: "Review",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "screen" },
      parallel: { completeWhen: "ALL" },
    },
    {
      key: "wait",
      name: "Wait",
      type: "WAIT_PROPONENT",
      deadline: { amount: 30, unit: "WORKING_DAYS" },
    },
    { key: "end", name: "End", type: "END" },
  ],
  transitions: [
    { from: "submit", to: "screen" },
    { from: "screen", to: "review", when: { "==": [{ var: "outcome" }, "ACCEPT"] } },
    { from: "screen", to: "wait", when: { "==": [{ var: "outcome" }, "RETURN"] } },
    { from: "wait", to: "submit" },
    { from: "review", to: "end" },
  ],
};

describe("validateGraph", () => {
  it("accepts a graph that can be walked", () => {
    expect(validateGraph(base, new Set(["F-31"]))).toEqual([]);
  });

  it("rejects an unreachable step, a missing outcome, and an unknown form", () => {
    const broken: WorkflowGraph = {
      ...base,
      steps: [
        ...base.steps.map((step) =>
          step.key === "screen" ? { ...step, forms: [{ code: "F-MISSING", mode: "FILL" as const, required: true }] } : step,
        ),
        { key: "orphan", name: "Orphan", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
      ],
      transitions: base.transitions.filter((transition) => transition.to !== "wait"),
    };
    const messages = validateGraph(broken, new Set()).map((issue) => issue.message);
    expect(messages.some((message) => message.includes("cannot be reached"))).toBe(true);
    expect(messages.some((message) => message.includes("Return"))).toBe(true);
    expect(messages.some((message) => message.includes("F-MISSING"))).toBe(true);
  });

  it("simulates a decision and a due date", () => {
    const start = new Date("2026-11-06T01:00:00.000Z");
    const graph: WorkflowGraph = {
      ...base,
      steps: base.steps.map((step) =>
        step.key === "screen" ? { ...step, deadline: { amount: 1, unit: "WORKING_DAYS" as const } } : step,
      ),
    };
    const run = simulateGraph(graph, [{ stepKey: "submit" }, { stepKey: "screen", outcome: "ACCEPT" }], new Set(["2026-11-09"]), start);
    expect(run.error).toBeNull();
    expect(run.stops.map((stop) => stop.stepKey)).toEqual(["submit", "screen", "review", "end"]);
    expect(run.stops[1]?.dueAt).toBe("2026-11-10T01:00:00.000Z");
  });
});
