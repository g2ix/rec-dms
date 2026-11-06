import "server-only";
import type { RoleView } from "@/lib/role-view";
import { readTransaction, useAppSchema } from "@/server/db";
import { reportScope, secretariatOrThrow } from "@/server/reports/access";
import { holidaySet, taskQuery, toQueueRow, type QueueRow } from "@/server/reports/rows";
import { stepFacts } from "@/server/reports/steps";
import { openTasks } from "@/server/workflow/inbox";

export async function inboxList(userId: string, view: RoleView): Promise<{ total: number; rows: QueueRow[] }> {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const facts = await stepFacts(tx);
    const holidays = await holidaySet(tx);
    const now = new Date();
    const { total, ids } = await openTasks(tx, userId, view, 100);
    const tasks = ids.length === 0 ? [] : await tx.task.findMany({ where: { id: { in: ids } }, ...taskQuery });
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const revision = new Set(facts.revisionKeys);
    return {
      total,
      rows: ids.flatMap((id) => {
        const task = byId.get(id);
        const row = task ? toQueueRow(task, facts, holidays, now, revision) : null;
        return row ? [row] : [];
      }),
    };
  });
}

export async function completedReviewList(userId: string): Promise<{ total: number; rows: QueueRow[] }> {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const facts = await stepFacts(tx);
    const holidays = await holidaySet(tx);
    const now = new Date();
    const where = {
      assigneeUserId: userId,
      status: "COMPLETED" as const,
      ...(facts.reviewStepKeys.length > 0
        ? { stepKey: { in: facts.reviewStepKeys } }
        : { candidateRule: { path: ["kind"], equals: "ASSIGNED_IN_STEP" } }),
    };
    const [total, tasks] = await Promise.all([
      tx.task.count({ where }),
      tx.task.findMany({ where, ...taskQuery, orderBy: { completedAt: "desc" }, take: 100 }),
    ]);
    return { total, rows: tasks.flatMap((task) => { const row = toQueueRow(task, facts, holidays, now, new Set()); return row ? [row] : []; }) };
  });
}

async function chairPanelIds(tx: Parameters<typeof reportScope>[0], userId: string): Promise<string[] | "all"> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null, role: { key: "PANEL_CHAIR" }, panelId: { not: null } },
    select: { panelId: true },
  });
  const panelIds = [...new Set(grants.flatMap((grant) => (grant.panelId ? [grant.panelId] : [])))];
  if (panelIds.length > 0) return panelIds;
  const scope = await reportScope(tx, userId);
  return scope.kind === "all" ? "all" : scope.panelIds;
}

export async function panelProtocolList(userId: string, step?: string) {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const panels = await chairPanelIds(tx, userId);
    const panelId = panels === "all" ? undefined : { in: panels };
    const facts = await stepFacts(tx);
    const protocols = await tx.protocol.findMany({
      where: {
        ...(panelId ? { panelId } : {}),
        workflowInstances: { some: { status: "RUNNING", ...(step ? { currentStepKeys: { has: step } } : {}) } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        reviewType: true,
        workflowInstances: { where: { status: "RUNNING" }, take: 1, select: { currentStepKeys: true } },
      },
    });
    return protocols.map((protocol) => ({
      ...protocol,
      stepName: (protocol.workflowInstances[0]?.currentStepKeys ?? []).map((key) => facts.name(key)).join(", ") || "—",
    }));
  });
}

export async function reviewerLoadList(userId: string) {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const panels = await chairPanelIds(tx, userId);
    const grouped = await tx.task.groupBy({
      by: ["assigneeUserId"],
      where: {
        status: { in: ["OPEN", "CLAIMED"] },
        assigneeUserId: { not: null },
        instance: { status: "RUNNING", protocol: panels === "all" ? {} : { panelId: { in: panels } } },
        candidateRule: { path: ["kind"], equals: "ASSIGNED_IN_STEP" },
      },
      _count: { _all: true },
    });
    const ids = grouped.flatMap((row) => (row.assigneeUserId ? [row.assigneeUserId] : []));
    const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
    const names = new Map(users.map((user) => [user.id, user.displayName]));
    return grouped
      .flatMap((row) => (row.assigneeUserId ? [{ name: names.get(row.assigneeUserId) ?? "Reviewer", open: row._count._all }] : []))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  });
}

export async function revisionList(userId: string): Promise<{ total: number; rows: QueueRow[] }> {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const facts = await stepFacts(tx);
    if (facts.revisionKeys.length === 0) return { total: 0, rows: [] };
    const holidays = await holidaySet(tx);
    const now = new Date();
    const where = {
      status: { in: ["OPEN", "CLAIMED"] as ("OPEN" | "CLAIMED")[] },
      stepKey: { in: facts.revisionKeys },
      instance: {
        status: "RUNNING" as const,
        protocol: { OR: [{ leaderUserId: userId }, { members: { some: { userId, role: "PROPONENT" as const, status: "ACTIVE" } } }] },
      },
    };
    const [total, tasks] = await Promise.all([
      tx.task.count({ where }),
      tx.task.findMany({ where, ...taskQuery, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: 100 }),
    ]);
    const revision = new Set(facts.revisionKeys);
    return { total, rows: tasks.flatMap((task) => { const row = toQueueRow(task, facts, holidays, now, revision); return row ? [row] : []; }) };
  });
}

export async function pendingUserList(userId: string) {
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    await secretariatOrThrow(tx, userId);
    return tx.user.findMany({
      where: { status: "PENDING_APPROVAL" },
      orderBy: { createdAt: "asc" },
      select: { id: true, displayName: true, email: true, createdAt: true },
    });
  });
}
