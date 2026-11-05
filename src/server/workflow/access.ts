import "server-only";
import type { Prisma } from "@prisma/client";
import { parseGraph } from "@/lib/workflow/graph";
import { readAssignments, readRule, userMatchesRule } from "@/server/workflow/who";

type Tx = Prisma.TransactionClient;

/** Step key when this person has an open task that asks them to fill or sign the form. */
export async function editingStepFor(
  tx: Tx,
  userId: string,
  protocolVersionId: string,
  formCode: string,
): Promise<string | null> {
  const tasks = await tx.task.findMany({
    where: {
      status: { in: ["OPEN", "CLAIMED"] },
      instance: { protocolVersionId, status: "RUNNING" },
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
    include: { instance: { include: { version: true, protocol: true } } },
  });
  for (const task of tasks) {
    if (!task.stepKey || !task.instance) continue;
    if (!task.assigneeUserId) {
      const rule = readRule(task.candidateRule);
      const protocol = task.instance.protocol;
      if (!rule || !(await userMatchesRule(tx, rule, userId, protocol, readAssignments(task.instance.assignments)))) {
        continue;
      }
    }
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.forms?.some((form) => form.code === formCode && form.mode !== "VIEW")) return step.key;
  }
  return null;
}
