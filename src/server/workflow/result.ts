import "server-only";
import { resultHref, type ActionResult, type ResultTarget } from "@/lib/action-result";
import { isRoleKey, ROLE_KEY_LABEL } from "@/lib/forms/roles";
import { formatManila } from "@/lib/time";
import { isReviewerAuthor, REVIEWER_LABEL } from "@/lib/workflow/blinding";
import { parseGraph, type AssigneeRule, type Step } from "@/lib/workflow/graph";
import { completionTitle, nextStepSentence, type NextTask } from "@/lib/workflow/next-step";
import { prisma } from "@/server/db";
import { returnsToProponent } from "@/server/workflow/comments";
import { reviewerNameMask } from "@/server/workflow/read";
import { readRule } from "@/server/workflow/who";

const OPEN = ["OPEN", "CLAIMED"];
const PASS_COMPLETE = "This pass is complete. No further step is open.";

function roleLabelOf(rule: AssigneeRule | null): string | null {
  if (rule?.kind === "FIRST_AVAILABLE") return roleLabelOf(rule.rules[0] ?? null);
  if (rule?.kind !== "ROLE" && rule?.kind !== "PANEL_ROLE_OF_PROTOCOL") return null;
  return isRoleKey(rule.role) ? ROLE_KEY_LABEL[rule.role] : rule.role;
}

/**
 * Who acts next on this protocol and by when, read from the open tasks of its latest running workflow.
 * A role task shows the role. A person shows under the name this viewer may see.
 */
export async function nextStepLine(protocolId: string, viewerId: string, kind: "MAIN" | "SIDE" = "MAIN"): Promise<string | null> {
  const tasks = await prisma.task.findMany({
    where: { kind, status: { in: OPEN }, instance: { protocolId, status: "RUNNING" } },
    orderBy: { createdAt: "asc" },
    include: {
      assignee: { select: { id: true, displayName: true } },
      instance: { select: { id: true, startedAt: true, version: { select: { graph: true } } } },
    },
  });
  const latest = tasks.reduce<(typeof tasks)[number]["instance"]>(
    (found, task) => (task.instance && (!found || task.instance.startedAt > found.startedAt) ? task.instance : found),
    null,
  );
  if (!latest) return null;
  const parsed = parseGraph(latest.version.graph);
  const steps: Step[] = parsed.ok ? parsed.graph.steps : [];
  const nameFor = await reviewerNameMask(protocolId, viewerId);
  const rows: NextTask[] = tasks
    .filter((task) => task.instanceId === latest.id)
    .map((task) => {
      const step = steps.find((item) => item.key === task.stepKey);
      const side = kind === "SIDE" ? step?.sideTasks?.find((item) => item.key === task.sideKey) : undefined;
      const rule = readRule(task.candidateRule) ?? side?.assignee ?? step?.assignee ?? null;
      return {
        stepName: task.title || side?.name || step?.name || "Task",
        assigneeUserId: task.assigneeUserId,
        assigneeName:
          nameFor(task.assignee?.id, task.assignee?.displayName, rule) ??
          (rule?.kind === "ASSIGNED_IN_STEP" ? REVIEWER_LABEL : null),
        roleLabel: roleLabelOf(rule),
        dueAt: task.dueAt,
        deadline: kind === "MAIN" && step?.deadline ? { amount: step.deadline.amount, unit: step.deadline.unit } : null,
      };
    });
  return nextStepSentence(rows, viewerId, (date) => formatManila(date, "d MMM yyyy"));
}

/** A result for an action that is not one workflow task, such as submit or an extension request. */
export async function protocolResult(input: {
  title: string;
  protocolId: string;
  viewerId: string;
  target: ResultTarget;
  kind?: "MAIN" | "SIDE";
}): Promise<ActionResult> {
  const href = resultHref(input.target, input.protocolId);
  try {
    return { title: input.title, body: await nextStepLine(input.protocolId, input.viewerId, input.kind), href };
  } catch {
    // The action is already committed. A failed summary must not read as a failed action.
    return { title: input.title, body: null, href };
  }
}

/** The dialog for a task this viewer just completed. A reviewer's task returns to My reviews. */
export async function taskResult(taskId: string, protocolId: string, viewerId: string): Promise<ActionResult> {
  try {
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        instance: {
          select: {
            status: true,
            version: { select: { graph: true } },
            protocol: { select: { leaderUserId: true, leader: { select: { displayName: true } } } },
          },
        },
      },
    });
    const parsed = parseGraph(task.instance?.version.graph);
    const graph = parsed.ok ? parsed.graph : null;
    const step = graph?.steps.find((item) => item.key === task.stepKey);
    const side = task.kind === "SIDE" ? step?.sideTasks?.find((item) => item.key === task.sideKey) : undefined;
    const rule = readRule(task.candidateRule) ?? side?.assignee ?? step?.assignee ?? null;
    const outcomes = side?.outcomes ?? step?.outcomes ?? [];
    const main = task.kind === "MAIN";
    const title = completionTitle({
      stepName: task.title || side?.name || step?.name || "Task",
      outcomeLabel: outcomes.find((item) => item.key === task.outcome)?.label ?? null,
      isReturn: Boolean(main && graph && task.stepKey && returnsToProponent(graph, task.stepKey, task.outcome)),
      isSubmission: Boolean(main && graph && task.stepKey === graph.startStep && task.instance?.protocol.leaderUserId === viewerId),
      leaderName: task.instance?.protocol.leader?.displayName ?? null,
      hasComment: Boolean(task.comment),
    });
    const next = await nextStepLine(protocolId, viewerId);
    const body = next ?? (task.instance?.status === "COMPLETED" ? PASS_COMPLETE : null);
    return { title, body, href: resultHref(isReviewerAuthor(rule, undefined) ? "review" : "protocol", protocolId) };
  } catch {
    // The task is already completed. A failed summary must not read as a failed action.
    return { title: "Task completed.", body: null, href: resultHref("protocol", protocolId) };
  }
}
