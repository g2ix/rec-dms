import "server-only";
import type { Prisma } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { isReviewerAuthor, REVIEWER_LABEL, seesReviewerNames } from "@/lib/workflow/blinding";
import { dueState, type DueState } from "@/lib/workflow/due";
import { parseGraph, slotsOf, stepAllowsConflict, type AssigneeRule, type ReviewerSlot, type Step } from "@/lib/workflow/graph";
import { isCommitteeStaff } from "@/server/authz/staff";
import { prisma, useAppSchema } from "@/server/db";
import { openTasks } from "@/server/workflow/inbox";
import { readAssignments, readRule, roleKeysFor, userMatchesRule } from "@/server/workflow/who";
import { REDESIGNATE_SIDE_KEY, reviewerCaptures } from "@/server/workflow/engine";

export { taskMatchesView } from "@/lib/workflow/views";

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

export async function inboxRows(tx: Prisma.TransactionClient, ids: string[]): Promise<InboxRow[]> {
  if (ids.length === 0) return [];
  const tasks = await tx.task.findMany({
    where: { id: { in: ids } },
    include: { instance: { include: { protocol: true, version: true } } },
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rows: InboxRow[] = [];
  for (const id of ids) {
    const task = byId.get(id);
    if (!task?.instance || !task.stepKey) continue;
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
      claimed: task.status === "CLAIMED" || Boolean(task.assigneeUserId),
      href: forms ? `/app/protocols/${task.instance.protocolId}/forms` : `/app/protocols/${task.instance.protocolId}`,
    });
  }
  return rows;
}

export async function inboxFor(userId: string, view: RoleView | "all"): Promise<InboxRow[]> {
  return prisma.$transaction(async (tx) => {
    const db = tx as unknown as Prisma.TransactionClient;
    await useAppSchema(db);
    const { ids } = await openTasks(db, userId, view);
    return inboxRows(db, ids);
  });
}

export type OpenTaskView = {
  id: string;
  step: Step;
  dueAt: Date | null;
  due: DueState;
  assigneeName: string | null;
  mine: boolean;
};

/** Display only: gives the name this viewer may see for a person on this protocol. Stored records are not changed. */
export async function reviewerNameMask(protocolId: string, viewerId: string) {
  const memberRows = await prisma.protocolMember.findMany({
    where: { protocolId },
    select: { userId: true, role: true, status: true },
  });
  const members = new Map(memberRows.flatMap((row) => (row.userId ? [[row.userId, row] as const] : [])));
  const showNames = seesReviewerNames(await isCommitteeStaff(viewerId), memberRows, viewerId);
  return (personId: string | null | undefined, name: string | null | undefined, rule: AssigneeRule | null = null): string | null => {
    if (!name) return null;
    return !showNames && isReviewerAuthor(rule, members.get(personId ?? "")) ? REVIEWER_LABEL : name;
  };
}

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
      if (rule && (await userMatchesRule(db, rule, userId, protocol, readAssignments(instance.assignments)))) actionable.push(task);
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
  const nameFor = await reviewerNameMask(protocolId, userId);
  return {
    instance,
    steps,
    current,
    open: open.map(({ assignee, ...task }) => ({
      ...task,
      assigneeName: nameFor(assignee?.id, assignee?.displayName, readRule(task.candidateRule)),
    })),
    history: history.map(({ actor, ...event }) => ({
      ...event,
      actorName: nameFor(event.actorUserId, actor?.displayName),
    })),
    mine: await Promise.all(
      actionable.map(async (task) => {
        const step = steps.find((item) => item.key === task.stepKey) ?? null;
        const redesignate = task.kind === "SIDE" && task.sideKey === REDESIGNATE_SIDE_KEY;
        const side = task.kind === "SIDE" && !redesignate ? step?.sideTasks?.find((item) => item.key === task.sideKey) ?? null : null;
        const source = step?.assignee?.kind === "ASSIGNED_IN_STEP" ? steps.find((item) => item.key === (step.assignee as { stepKey: string }).stepKey) : undefined;
        const slot = task.slot ? (slotsOf(source).find((item) => item.key === task.slot) ?? null) : null;
        const captures = step && task.kind === "MAIN" ? await reviewerCaptures(prisma, instance.id, step) : { noteToReviewers: null, reviewDueDate: null };
        return {
          id: task.id,
          step,
          side,
          kind: task.kind,
          redesignate,
          slot,
          dueAt: task.dueAt,
          due: dueState(task.dueAt),
          assigneeUserId: task.assigneeUserId,
          noteToReviewers: captures.noteToReviewers,
          reviewDueDate: captures.reviewDueDate,
          canDeclareConflict: Boolean(step && task.kind === "MAIN" && stepAllowsConflict(step)),
        };
      }),
    ),
    extension:
      current.some((step) => (step.sideTasks?.length ?? 0) > 0) && protocol.leaderUserId === userId
        ? { instanceId: instance.id, step: current.find((step) => (step.sideTasks?.length ?? 0) > 0) ?? null }
        : null,
  };
}

export async function reviewerOptions(protocolId: string, roles: string[]) {
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { key: { in: roles } } },
    include: { user: { select: { id: true, displayName: true, status: true } } },
  });
  const conflicted = await conflictedIds(protocolId);
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

async function conflictedIds(protocolId: string): Promise<Set<string>> {
  const [members, declared] = await Promise.all([
    prisma.protocolMember.findMany({
      where: { protocolId, status: { not: "REMOVED" }, role: { in: ["PROPONENT", "ADVISER"] } },
      select: { userId: true },
    }),
    prisma.conflictDeclaration.findMany({ where: { protocolId }, select: { userId: true } }),
  ]);
  const out = new Set<string>();
  for (const row of members) if (row.userId) out.add(row.userId);
  for (const row of declared) out.add(row.userId);
  return out;
}

export type SlotOption = { id: string; name: string; group: "panel" | "alternate" | "other"; detail: string; openTasks: number };

function attributes(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * People who can fill a reviewer slot: members of the protocol panel first, then alternates,
 * then others who hold an eligible role. People with a conflict on the protocol are left out.
 */
export async function slotReviewerOptions(protocolId: string, slot: ReviewerSlot): Promise<SlotOption[]> {
  const protocol = await prisma.protocol.findUniqueOrThrow({ where: { id: protocolId }, select: { panelId: true } });
  const wanted = Object.entries(slot.eligible?.attributes ?? {});
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, ...(slot.eligible?.roles?.length ? { role: { key: { in: slot.eligible.roles } } } : {}) },
    include: { user: { select: { id: true, displayName: true, status: true } } },
  });
  const conflicted = await conflictedIds(protocolId);
  const best = new Map<string, SlotOption>();
  const rank = { panel: 0, alternate: 1, other: 2 } as const;
  for (const grant of grants) {
    if (grant.user.status !== "ACTIVE" || conflicted.has(grant.userId)) continue;
    const attrs = attributes(grant.attributes);
    if (!wanted.every(([key, value]) => attrs[key] === value)) continue;
    const group: SlotOption["group"] =
      attrs.alternate === true ? "alternate" : protocol.panelId && grant.panelId === protocol.panelId ? "panel" : "other";
    const detail = [attrs.designation, attrs.discipline].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ");
    const current = best.get(grant.userId);
    if (!current || rank[group] < rank[current.group]) {
      best.set(grant.userId, { id: grant.userId, name: grant.user.displayName, group, detail: detail || current?.detail || "", openTasks: 0 });
    }
  }
  const ids = [...best.keys()];
  const loads = ids.length
    ? await prisma.task.groupBy({ by: ["assigneeUserId"], where: { assigneeUserId: { in: ids }, status: { in: ["OPEN", "CLAIMED"] } }, _count: { _all: true } })
    : [];
  for (const row of loads) {
    const option = row.assigneeUserId ? best.get(row.assigneeUserId) : undefined;
    if (option) option.openTasks = row._count._all;
  }
  return [...best.values()].sort((a, b) => rank[a.group] - rank[b.group] || a.openTasks - b.openTasks || a.name.localeCompare(b.name));
}
