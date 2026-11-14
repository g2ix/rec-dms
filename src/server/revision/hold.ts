import "server-only";
import type { Prisma } from "@prisma/client";
import { parseGraph } from "@/lib/workflow/graph";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Whether the proponents hold the working version: no workflow pass has started, or the open step
 * of the latest pass is theirs (prepare, revise, or a correction after a return). Once they submit
 * to the adviser or REC, the version stays WORKING until it is frozen at screening, but it is no
 * longer theirs to change.
 */
export async function proponentsHoldVersion(db: Db, protocolId: string): Promise<boolean> {
  const instance = await db.workflowInstance.findFirst({
    where: { protocolId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { version: { select: { graph: true } }, tasks: { where: { status: { in: ["OPEN", "CLAIMED"] }, kind: "MAIN" }, select: { stepKey: true } } },
  });
  if (!instance) return true;
  const parsed = parseGraph(instance.version.graph);
  if (!parsed.ok) return true;
  return instance.tasks.some((task) => {
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    return step?.assignee?.kind === "PROTOCOL_LEADER" || step?.assignee?.kind === "PROTOCOL_PROPONENTS";
  });
}

export const SUBMITTED_MESSAGE = "This version was submitted. It can change again only if it is returned to you.";

export async function assertProponentsHold(db: Db, protocolId: string): Promise<void> {
  if (!(await proponentsHoldVersion(db, protocolId))) throw new AppError("LOCKED", SUBMITTED_MESSAGE, 409);
}
