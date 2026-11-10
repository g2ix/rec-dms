import "server-only";
import { logicIsTrue } from "@/lib/forms/logic";
import { isRoleKey, ROLE_KEY_LABEL } from "@/lib/forms/roles";
import { isProponentSideRole, isReviewerAuthor, onProponentSide as isOnProponentSide, REVIEWER_LABEL, seesReviewerNames } from "@/lib/workflow/blinding";
import { parseGraph, type AssigneeRule, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { isCommitteeStaff } from "@/server/authz/staff";
import { readTransaction, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { canViewProtocol } from "@/server/protocols/read";
import { readRule } from "@/server/workflow/who";

export type TaskComment = {
  id: string;
  comment: string;
  stepName: string;
  outcomeLabel: string | null;
  author: string;
  /** Empty when the author is shown only as "Reviewer", or when no role is known. */
  role: string | null;
  at: Date;
};

export type ProtocolTaskComments = {
  /** Newest first. */
  comments: TaskComment[];
  /** The reason for the latest return, only while the protocol is still returned. */
  returnReason: TaskComment | null;
};

type Member = { role: string; isLeader: boolean };

const RETURNED = /^returned/i;

function returnsToProponent(graph: WorkflowGraph, stepKey: string, outcome: string | null): boolean {
  if (!outcome) return false;
  return graph.transitions.some((transition) => {
    if (transition.from !== stepKey || transition.when == null || !logicIsTrue(transition.when, { outcome })) return false;
    const label = transition.statusLabel ?? graph.steps.find((step) => step.key === transition.to)?.statusLabel;
    return RETURNED.test(label ?? "");
  });
}

/** Steps from the version freeze onward. A graph with no freeze is treated as review from the start. */
function reviewStepKeys(graph: WorkflowGraph): Set<string> {
  const queue = graph.steps.filter((step) => step.actions?.some((action) => action.kind === "SNAPSHOT_VERSION")).map((step) => step.key);
  if (queue.length === 0) return new Set(graph.steps.map((step) => step.key));
  const seen = new Set(queue);
  for (const key of queue) {
    for (const transition of graph.transitions) {
      if (transition.from !== key || seen.has(transition.to)) continue;
      seen.add(transition.to);
      queue.push(transition.to);
    }
  }
  return seen;
}

function isRelease(step: Step | undefined): boolean {
  return Boolean(step?.actions?.some((action) => action.kind === "GENERATE_DOCUMENTS"));
}

function roleLabel(key: string): string {
  return isRoleKey(key) ? ROLE_KEY_LABEL[key] : key;
}

function authorRole(rule: AssigneeRule | null, member: Member | undefined): string | null {
  if (rule?.kind === "ROLE" || rule?.kind === "PANEL_ROLE_OF_PROTOCOL") return roleLabel(rule.role);
  if (member?.isLeader) return ROLE_KEY_LABEL.PROJECT_LEADER;
  return member ? roleLabel(member.role) : null;
}

/**
 * Comments left when completing workflow tasks, filtered for this viewer.
 * Proponents and advisers do not see reviewer names, and see review-stage comments only after release.
 */
export async function protocolTaskComments(userId: string, protocolId: string): Promise<ProtocolTaskComments> {
  if (!(await canViewProtocol(userId, protocolId))) {
    throw new AppError("FORBIDDEN", "You cannot open this protocol.", 403);
  }
  const staff = await isCommitteeStaff(userId);
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const [protocol, memberRows, tasks] = await Promise.all([
      tx.protocol.findUniqueOrThrow({ where: { id: protocolId }, select: { status: true } }),
      tx.protocolMember.findMany({ where: { protocolId }, select: { userId: true, role: true, isLeader: true, status: true } }),
      tx.task.findMany({
        where: { status: "COMPLETED", instance: { protocolId } },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          instanceId: true,
          stepKey: true,
          sideKey: true,
          kind: true,
          title: true,
          outcome: true,
          comment: true,
          completedAt: true,
          completedById: true,
          candidateRule: true,
          completedBy: { select: { displayName: true } },
          instance: { select: { version: { select: { graph: true } } } },
        },
      }),
    ]);

    const members = new Map(memberRows.flatMap((row) => (row.userId ? [[row.userId, row] as const] : [])));
    const onProponentSide = isOnProponentSide(memberRows, userId);
    const showReviewerNames = seesReviewerNames(staff, memberRows, userId);

    const graphs = new Map<string, WorkflowGraph | null>();
    const graphOf = (task: (typeof tasks)[number]): WorkflowGraph | null => {
      const key = task.instanceId ?? "";
      if (!graphs.has(key)) {
        const parsed = parseGraph(task.instance?.version.graph);
        graphs.set(key, parsed.ok ? parsed.graph : null);
      }
      return graphs.get(key) ?? null;
    };
    const stepOf = (task: (typeof tasks)[number]) => graphOf(task)?.steps.find((step) => step.key === task.stepKey);
    const isReturn = (task: (typeof tasks)[number]) => {
      const graph = graphOf(task);
      return Boolean(graph && task.kind === "MAIN" && task.stepKey && returnsToProponent(graph, task.stepKey, task.outcome));
    };

    const released = new Set(tasks.filter((task) => isRelease(stepOf(task))).map((task) => task.instanceId));
    const heldFromProponents = (task: (typeof tasks)[number]) => {
      if (released.has(task.instanceId) || isReturn(task)) return false;
      if (isProponentSideRole(members.get(task.completedById ?? "")?.role)) return false;
      const graph = graphOf(task);
      return !graph || reviewStepKeys(graph).has(task.stepKey ?? "");
    };

    const comments = tasks.flatMap((task): TaskComment[] => {
      if (!task.comment || !task.completedAt) return [];
      if (onProponentSide && heldFromProponents(task)) return [];
      const step = stepOf(task);
      const side = task.kind === "SIDE" ? step?.sideTasks?.find((item) => item.key === task.sideKey) : undefined;
      const outcomes = side?.outcomes ?? step?.outcomes ?? [];
      const rule = readRule(task.candidateRule) ?? step?.assignee ?? null;
      const member = members.get(task.completedById ?? "");
      const hidden = !showReviewerNames && isReviewerAuthor(rule, member);
      return [
        {
          id: task.id,
          comment: task.comment,
          stepName: task.title || side?.name || step?.name || task.stepKey || "Task",
          outcomeLabel: outcomes.find((item) => item.key === task.outcome)?.label ?? null,
          author: hidden ? REVIEWER_LABEL : task.completedBy?.displayName ?? "System",
          role: hidden ? null : authorRole(rule, member),
          at: task.completedAt,
        },
      ];
    });

    const latestReturn = RETURNED.test(protocol.status) ? tasks.find(isReturn) : undefined;
    return { comments, returnReason: comments.find((item) => item.id === latestReturn?.id) ?? null };
  });
}
