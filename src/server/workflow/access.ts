import "server-only";
import type { Prisma } from "@prisma/client";
import { parseGraph } from "@/lib/workflow/graph";
import { readAssignments, readRule, roleKeysFor, userMatchesRule } from "@/server/workflow/who";

type Tx = Prisma.TransactionClient;

/** Step key when this person may fill the form: their open task, or the current step that lists it. */
export async function editingStepFor(
  tx: Tx,
  userId: string,
  protocolVersionId: string,
  formCode: string,
): Promise<string | null> {
  const fromTask = await stepFromTask(tx, userId, protocolVersionId, formCode);
  if (fromTask) return fromTask;
  const running = await tx.workflowInstance.findFirst({
    where: { protocolVersionId, status: "RUNNING" },
    include: { version: true, protocol: true },
    orderBy: { startedAt: "desc" },
  });
  if (!running) return null;
  const parsed = parseGraph(running.version.graph);
  if (!parsed.ok) return null;
  const member = await tx.protocolMember.findFirst({
    where: { protocolId: running.protocolId, userId, status: "ACTIVE" },
    select: { id: true },
  });
  const keys = await roleKeysFor(tx, userId);
  if (!member && keys.size === 0) return null;
  for (const key of running.currentStepKeys) {
    const step = parsed.graph.steps.find((item) => item.key === key);
    if (step?.forms?.some((form) => form.code === formCode && form.mode !== "VIEW")) return step.key;
  }
  return null;
}

async function stepFromTask(
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
