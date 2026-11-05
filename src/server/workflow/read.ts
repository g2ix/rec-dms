import "server-only";
import type { Prisma } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { dueState, type DueState } from "@/lib/workflow/due";
import { parseGraph, type AssigneeRule, type Step } from "@/lib/workflow/graph";
import { prisma } from "@/server/db";
import { readRule, roleKeysFor, userMatchesRule } from "@/server/workflow/who";

const VIEW_KIND: Record<RoleView, AssigneeRule["kind"][] | null> = {
  proponent: ["PROTOCOL_LEADER", "PROTOCOL_PROPONENTS"],
  adviser: ["PROTOCOL_ADVISER"],
  reviewer: ["ASSIGNED_IN_STEP"],
  "panel-chair": ["PANEL_ROLE_OF_PROTOCOL"],
  staff: ["ROLE"],
  chair: ["ROLE"],
};

const VIEW_ROLES: Record<RoleView, string[]> = {
  proponent: ["PROPONENT", "PROJECT_LEADER"],
  adviser: ["ADVISER"],
  reviewer: ["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "REC_MEMBER"],
  "panel-chair": ["PANEL_CHAIR"],
  staff: ["REC_STAFF", "MEMBER_SECRETARY"],
  chair: ["REC_CHAIR", "SYSTEM_ADMIN"],
};

export function taskMatchesView(rule: AssigneeRule | null, view: RoleView | "all"): boolean {
  if (view === "all") return true;
  if (!rule) return false;
  if (rule.kind === "USER") return true;
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    return VIEW_ROLES[view].includes(rule.role);
  }
  return VIEW_KIND[view]?.includes(rule.kind) ?? false;
}

export type InboxRow = {
  id: string;
  title: string;
  protocolId: string;
  protocolTitle: string;
  protocolCode: string | null;
  stepKey: string;
  dueAt: Date | null;
  due: DueState;
  claimed: boolean;
  href: string;
};

export async function inboxFor(userId: string, view: RoleView | "all"): Promise<InboxRow[]> {
  const db = prisma as unknown as Prisma.TransactionClient;
  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["OPEN", "CLAIMED"] },
      instanceId: { not: null },
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
    include: {
      instance: { include: { protocol: true, version: true } },
    },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
  });
  const rows: InboxRow[] = [];
  for (const task of tasks) {
    if (!task.instance || !task.stepKey) continue;
    const rule = readRule(task.candidateRule);
    if (!task.assigneeUserId) {
      const protocol = task.instance.protocol;
      if (!rule || !(await userMatchesRule(db, rule, userId, protocol, {}))) continue;
    } else if (task.assigneeUserId !== userId) {
      continue;
    }
    if (!taskMatchesView(rule, view)) continue;
    const graph = parseGraph(task.instance.version.graph);
    const step = graph.ok ? graph.graph.steps.find((item) => item.key === task.stepKey) : undefined;
    const forms = Boolean(step?.forms?.length);
    rows.push({
      id: task.id,
      title: task.title || step?.name || task.stepKey,
      protocolId: task.instance.protocolId,
      protocolTitle: task.instance.protocol.title,
      protocolCode: task.instance.protocol.code,
      stepKey: task.stepKey,
      dueAt: task.dueAt,
      due: dueState(task.dueAt),
      claimed: task.status === "CLAIMED" || task.assigneeUserId === userId,
      href: forms ? `/app/protocols/${task.instance.protocolId}/forms` : `/app/protocols/${task.instance.protocolId}`,
    });
  }
  return rows;
}

export type OpenTaskView = {
  id: string;
  step: Step;
  dueAt: Date | null;
  due: DueState;
  assigneeName: string | null;
  mine: boolean;
};

export async function protocolFlow(protocolId: string, userId: string) {
  const instance = await prisma.workflowInstance.findFirst({
    where: { protocolId },
    orderBy: { startedAt: "desc" },
    include: {
      version: { include: { definition: true } },
      tasks: {
        orderBy: { createdAt: "asc" },
        include: { assignee: { select: { id: true, displayName: true } }, completedBy: { select: { displayName: true } } },
      },
    },
  });
  if (!instance) return null;
  const graph = parseGraph(instance.version.graph);
  const steps = graph.ok ? graph.graph.steps : [];
  const current = instance.currentStepKeys
    .map((key) => steps.find((step) => step.key === key))
    .filter((step): step is Step => Boolean(step));
  const open = instance.tasks.filter((task) => task.status === "OPEN" || task.status === "CLAIMED");
  const db = prisma as unknown as Prisma.TransactionClient;
  const protocol = await prisma.protocol.findUniqueOrThrow({ where: { id: protocolId } });
  const actionable = [];
  for (const task of open) {
    if (task.assigneeUserId === userId) {
      actionable.push(task);
      continue;
    }
    if (!task.assigneeUserId) {
      const rule = readRule(task.candidateRule);
      if (rule && (await userMatchesRule(db, rule, userId, protocol, {}))) actionable.push(task);
    }
  }
  const history = await prisma.auditEvent.findMany({
    where: {
      protocolId,
      action: { in: ["workflow.step_entered", "task.completed", "task.reassigned", "workflow.instance_completed"] },
    },
    orderBy: { occurredAt: "desc" },
    take: 40,
    include: { actor: { select: { displayName: true } } },
  });
  return {
    instance,
    steps,
    current,
    open,
    history,
    mine: actionable.map((task) => ({
      id: task.id,
      step: steps.find((step) => step.key === task.stepKey) ?? null,
      dueAt: task.dueAt,
      due: dueState(task.dueAt),
      assigneeUserId: task.assigneeUserId,
    })),
  };
}

export async function reviewerOptions(protocolId: string, roles: string[]) {
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { key: { in: roles } } },
    include: { user: { select: { id: true, displayName: true, status: true } } },
  });
  const conflicted = new Set(
    (
      await prisma.protocolMember.findMany({
        where: { protocolId, status: { not: "REMOVED" }, role: { in: ["PROPONENT", "ADVISER"] } },
        select: { userId: true },
      })
    )
      .map((member) => member.userId)
      .filter((id): id is string => Boolean(id)),
  );
  const ids = [...new Set(grants.map((grant) => grant.userId))].filter((id) => !conflicted.has(id));
  const loads = await prisma.task.groupBy({
    by: ["assigneeUserId"],
    where: { assigneeUserId: { in: ids }, status: { in: ["OPEN", "CLAIMED"] } },
    _count: { _all: true },
  });
  const loadOf = new Map(loads.map((row) => [row.assigneeUserId, row._count._all]));
  const seen = new Set<string>();
  const options = [];
  for (const grant of grants) {
    if (grant.user.status !== "ACTIVE" || conflicted.has(grant.userId) || seen.has(grant.userId)) continue;
    seen.add(grant.userId);
    const keys = await roleKeysFor(prisma as unknown as Prisma.TransactionClient, grant.userId);
    options.push({
      id: grant.userId,
      name: grant.user.displayName,
      roles: roles.filter((role) => keys.has(role)),
      openTasks: loadOf.get(grant.userId) ?? 0,
    });
  }
  return options.sort((a, b) => a.openTasks - b.openTasks || a.name.localeCompare(b.name));
}
