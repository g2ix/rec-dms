import "server-only";
import type { Prisma } from "@prisma/client";
import { parseGraph, type Step } from "@/lib/workflow/graph";

export type StepFacts = {
  name: (key: string) => string;
  screeningKeys: string[];
  acceptOutcomes: string[];
  releaseKeys: string[];
  meetingKeys: string[];
  revisionKeys: string[];
  decisionKeys: string[];
  reviewStepKeys: string[];
  outcomeLabel: (key: string) => string;
};

export function factsFromGraphs(graphs: unknown[]): StepFacts {
  const steps = new Map<string, Step>();
  const outcomeLabels = new Map<string, string>();
  for (const graph of graphs) {
    const parsed = parseGraph(graph);
    if (!parsed.ok) continue;
    for (const step of parsed.graph.steps) {
      if (!steps.has(step.key)) steps.set(step.key, step);
      for (const outcome of step.outcomes ?? []) {
        if (!outcomeLabels.has(outcome.key)) outcomeLabels.set(outcome.key, outcome.label);
      }
    }
  }
  const all = [...steps.values()];
  const screening = all.filter((step) => (step.feeVerifiedOutcomes?.length ?? 0) > 0);
  return {
    name: (key) => steps.get(key)?.name ?? key,
    screeningKeys: screening.map((step) => step.key),
    acceptOutcomes: [...new Set(screening.flatMap((step) => step.feeVerifiedOutcomes ?? []))],
    releaseKeys: all.filter((step) => step.actions?.some((action) => action.kind === "GENERATE_DOCUMENTS")).map((step) => step.key),
    meetingKeys: all.filter((step) => step.capture?.meetingDate).map((step) => step.key),
    revisionKeys: all.filter((step) => step.type === "WAIT_PROPONENT").map((step) => step.key),
    decisionKeys: all
      .filter((step) => {
        if (step.capture?.meetingDate) return true;
        if (step.type !== "DECISION") return false;
        return !(step.setFields ?? []).some((field) => field.path === "protocol.reviewType");
      })
      .map((step) => step.key),
    reviewStepKeys: all.filter((step) => step.assignee?.kind === "ASSIGNED_IN_STEP").map((step) => step.key),
    outcomeLabel: (key) => outcomeLabels.get(key) ?? key,
  };
}

export async function stepFacts(tx: Prisma.TransactionClient): Promise<StepFacts> {
  const versions = await tx.workflowVersion.findMany({
    where: { status: "PUBLISHED" },
    select: { graph: true },
    orderBy: { publishedAt: "asc" },
  });
  return factsFromGraphs(versions.map((version) => version.graph));
}
