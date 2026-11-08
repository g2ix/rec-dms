import "server-only";
import { Prisma, type Prisma as PrismaTypes, type ReviewType } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { REVIEW_TYPES, type TurnaroundSummary } from "@/lib/reports/metrics";
import { prisma, readTransaction, useAppSchema as pinAppSchema } from "@/server/db";
import { constrainPanel, reportScope, type ReportScope } from "@/server/reports/access";
import { holidaySet, taskQuery, toQueueRow, type QueueRow } from "@/server/reports/rows";
import { chairPack, staffPack, type StepPreview } from "@/server/reports/snapshot";
import { factsFromGraphs, stepFacts, type StepFacts } from "@/server/reports/steps";
import { turnaroundSummary } from "@/server/reports/turnaround";
import { openTasks } from "@/server/workflow/inbox";

const PREVIEW = 8;
const OPEN = ["OPEN", "CLAIMED"] as const;

export type StepCount = { key: string; name: string; reviewType: string; count: number; href: string };
export type LoadRow = { userId: string; name: string; open: number };

export type StatusCount = { status: string; count: number };

export type DashboardModel =
  | { view: "proponent"; waiting: Bucket; revisions: Bucket; protocols: Bucket; statuses: StatusCount[] }
  | { view: "adviser"; waiting: Bucket; protocols: Bucket }
  | { view: "reviewer"; open: Bucket; completed: Bucket }
  | { view: "panel-chair"; waiting: Bucket; steps: StepCount[]; loads: LoadRow[]; overdue: Bucket; panelLabel: string }
  | { view: "staff"; waiting: Bucket; screening: Bucket; receipts: number; releases: Bucket; pendingUsers: number; overdue: Bucket }
  | { view: "chair"; waiting: Bucket; pipeline: StepCount[]; overdue: number; turnaround: TurnaroundSummary[] };

type Bucket = { total: number; rows: QueueRow[] };
type Tx = PrismaTypes.TransactionClient;

export async function loadDashboard(userId: string, view: RoleView): Promise<DashboardModel> {
  return prisma.$transaction(async (tx) => dashboardIn(tx, userId, view), { timeout: 20_000 });
}

export async function dashboardIn(tx: Tx, userId: string, view: RoleView, now = new Date()): Promise<DashboardModel> {
  await pinAppSchema(tx);
  if (view === "staff") return staffDashboard(tx, userId, now);
  if (view === "chair") return chairDashboard(tx, userId, now);
  const facts = await stepFacts(tx);
  const holidays = await holidaySet(tx);
  const waiting = await bucketFromInbox(tx, userId, view, facts, holidays, now);
  if (view === "proponent") {
    const [revisionBucket, protocolBucket, statuses] = await Promise.all([
      revisions(tx, userId, facts, holidays, now),
      memberProtocols(tx, userId, "PROPONENT", facts),
      protocolStatuses(tx, userId),
    ]);
    return { view, waiting, revisions: revisionBucket, protocols: protocolBucket, statuses };
  }
  if (view === "adviser") {
    return { view, waiting, protocols: await memberProtocols(tx, userId, "ADVISER", facts) };
  }
  if (view === "reviewer") {
    return { view, open: waiting, completed: await completedReviews(tx, userId, facts, holidays, now) };
  }
  if (view === "panel-chair") {
    const panelIds = await chairPanels(tx, userId);
    const panels = panelIds.length
      ? await tx.panel.findMany({ where: { id: { in: panelIds } }, select: { name: true }, orderBy: { code: "asc" } })
      : [];
    return {
      view,
      waiting,
      steps: await stepCounts(tx, facts, { kind: "panels", panelIds: panelIds.length ? panelIds : ["__none__"] }),
      loads: await reviewerLoad(tx, panelIds),
      overdue: await overdueBucket(tx, facts, holidays, now, panelIds),
      panelLabel: panels.map((panel) => panel.name).join(", ") || "No panel assigned",
    };
  }
  const unsupported: never = view;
  throw new Error(`Unsupported role view: ${unsupported}`);
}

async function staffDashboard(tx: Tx, userId: string, now: Date): Promise<DashboardModel> {
  const pack = await staffPack(tx, userId, now);
  const facts = factsFromGraphs(pack.graphs ?? []);
  const holidays = new Set(pack.holidays ?? []);
  const screeningIds = previewIds(pack.steps ?? [], facts.screeningKeys);
  const releaseIds = previewIds(pack.steps ?? [], facts.releaseKeys);
  const waitingIds = pack.waitingIds ?? [];
  const overdueIds = pack.overdueIds ?? [];
  const rows = await rowsFor(tx, unique([...waitingIds, ...screeningIds, ...releaseIds, ...overdueIds]), facts, holidays, now);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pick = (ids: string[]) => ids.flatMap((id) => { const row = byId.get(id); return row ? [row] : []; });
  const countOf = (keys: string[]) => (pack.steps ?? []).reduce((sum, step) => (keys.includes(step.step) ? sum + Number(step.n) : sum), 0);
  return {
    view: "staff",
    waiting: { total: Number(pack.waiting ?? 0), rows: pick(waitingIds) },
    screening: { total: countOf(facts.screeningKeys), rows: pick(screeningIds) },
    receipts: Number(pack.receipts ?? 0),
    releases: { total: countOf(facts.releaseKeys), rows: pick(releaseIds) },
    pendingUsers: Number(pack.pendingUsers ?? 0),
    overdue: { total: Number(pack.overdue ?? 0), rows: pick(overdueIds) },
  };
}

async function chairDashboard(tx: Tx, userId: string, now: Date): Promise<DashboardModel> {
  const pack = await chairPack(tx, userId, now);
  const facts = factsFromGraphs(pack.graphs ?? []);
  const holidays = new Set(pack.holidays ?? []);
  const waitingIds = pack.waitingIds ?? [];
  const panelIds = pack.panelIds ?? [];
  const scope: ReportScope = pack.all ? { kind: "all" } : { kind: "panels", panelIds };
  return {
    view: "chair",
    waiting: { total: Number(pack.waiting ?? 0), rows: await rowsFor(tx, waitingIds, facts, holidays, now) },
    pipeline: (pack.pipeline ?? []).map((row) => {
      const reviewType = row.reviewType && REVIEW_TYPES.includes(row.reviewType as ReviewType) ? row.reviewType : "";
      const params = new URLSearchParams({ step: row.step });
      if (reviewType) params.set("reviewType", reviewType);
      return {
        key: row.step,
        name: facts.name(row.step),
        reviewType: reviewType || "Not set",
        count: Number(row.n),
        href: `/app/reports?${params.toString()}`,
      };
    }),
    overdue: Number(pack.overdue ?? 0),
    turnaround: panelIds.length === 0 && !pack.all ? [] : await turnaroundSummary(tx, facts, scope),
  };
}

function previewIds(steps: StepPreview[], keys: string[]): string[] {
  const wanted = new Set(keys);
  return steps
    .filter((step) => wanted.has(step.step))
    .flatMap((step) => step.preview ?? [])
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map((item) => item.id);
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function bucketFromInbox(tx: Tx, userId: string, view: RoleView, facts: StepFacts, holidays: Set<string>, now: Date): Promise<Bucket> {
  const { total, ids } = await openTasks(tx, userId, view, PREVIEW);
  return { total, rows: await rowsFor(tx, ids, facts, holidays, now) };
}

async function rowsFor(tx: Tx, ids: string[], facts: StepFacts, holidays: Set<string>, now: Date): Promise<QueueRow[]> {
  if (ids.length === 0) return [];
  const tasks = await tx.task.findMany({ where: { id: { in: ids } }, ...taskQuery });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const revision = new Set(facts.revisionKeys);
  return ids.flatMap((id) => {
    const task = byId.get(id);
    const row = task ? toQueueRow(task, facts, holidays, now, revision) : null;
    return row ? [row] : [];
  });
}

async function revisions(tx: Tx, userId: string, facts: StepFacts, holidays: Set<string>, now: Date): Promise<Bucket> {
  if (facts.revisionKeys.length === 0) return { total: 0, rows: [] };
  const where = {
    status: { in: [...OPEN] },
    stepKey: { in: facts.revisionKeys },
    instance: {
      status: "RUNNING" as const,
      protocol: { OR: [{ leaderUserId: userId }, { members: { some: { userId, role: "PROPONENT" as const, status: "ACTIVE" } } }] },
    },
  };
  const [total, tasks] = await Promise.all([
    tx.task.count({ where }),
    tx.task.findMany({ where, ...taskQuery, orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: PREVIEW }),
  ]);
  const revision = new Set(facts.revisionKeys);
  return { total, rows: tasks.flatMap((task) => { const row = toQueueRow(task, facts, holidays, now, revision); return row ? [row] : []; }) };
}

async function memberProtocols(tx: Tx, userId: string, role: "PROPONENT" | "ADVISER", facts: StepFacts): Promise<Bucket> {
  const where = { userId, role, status: { not: "REMOVED" as const } };
  const [total, members] = await Promise.all([
    tx.protocolMember.count({ where }),
    tx.protocolMember.findMany({
      where,
      orderBy: { protocol: { updatedAt: "desc" } },
      take: PREVIEW,
      select: {
        protocol: {
          select: {
            id: true,
            code: true,
            title: true,
            status: true,
            updatedAt: true,
            workflowInstances: {
              where: { status: "RUNNING" },
              orderBy: { startedAt: "desc" },
              take: 1,
              select: {
                currentStepKeys: true,
                tasks: {
                  where: { status: { in: [...OPEN] }, kind: "MAIN" },
                  select: { stepKey: true, dueAt: true, candidateRule: true, assignee: { select: { displayName: true } } },
                  take: 6,
                },
              },
            },
          },
        },
      },
    }),
  ]);
  return {
    total,
    rows: members.map((member) => {
      const protocol = member.protocol;
      const instance = protocol.workflowInstances[0];
      const tasks = instance?.tasks ?? [];
      const stepKey = instance?.currentStepKeys[0] ?? tasks[0]?.stepKey ?? null;
      const dueAt = tasks.map((task) => task.dueAt).filter((due): due is Date => Boolean(due)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const names = [...new Set(tasks.map((task) => task.assignee?.displayName).filter((name): name is string => Boolean(name)))];
      return {
        id: protocol.id,
        href: `/app/protocols/${protocol.id}`,
        code: protocol.code,
        title: protocol.title,
        status: protocol.status,
        step: stepKey ? facts.name(stepKey) : "Not started",
        holder: names.length > 0 ? names.join(", ") : tasks.length > 0 ? "Unclaimed" : "—",
        dueAt,
        due: dueAt && dueAt.getTime() < Date.now() ? "overdue" : dueAt ? "scheduled" : "none",
        note: null,
        updatedAt: protocol.updatedAt,
      } satisfies QueueRow;
    }),
  };
}

async function protocolStatuses(tx: Tx, userId: string): Promise<StatusCount[]> {
  const memberships = await tx.protocolMember.findMany({
    where: { userId, role: "PROPONENT", status: { not: "REMOVED" } },
    select: { protocol: { select: { status: true } } },
  });
  const counts = new Map<string, number>();
  for (const membership of memberships) {
    const status = membership.protocol.status.trim() || "Draft";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([status, count]) => ({ status, count }));
}

async function completedReviews(tx: Tx, userId: string, facts: StepFacts, holidays: Set<string>, now: Date): Promise<Bucket> {
  const where = {
    assigneeUserId: userId,
    status: "COMPLETED" as const,
    ...(facts.reviewStepKeys.length > 0 ? { stepKey: { in: facts.reviewStepKeys } } : { candidateRule: { path: ["kind"], equals: "ASSIGNED_IN_STEP" } }),
  };
  const [total, tasks] = await Promise.all([
    tx.task.count({ where }),
    tx.task.findMany({ where, ...taskQuery, orderBy: { completedAt: "desc" }, take: PREVIEW }),
  ]);
  return { total, rows: tasks.flatMap((task) => { const row = toQueueRow(task, facts, holidays, now, new Set()); return row ? [row] : []; }) };
}

async function chairPanels(tx: Tx, userId: string): Promise<string[]> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null, panelId: { not: null }, role: { key: "PANEL_CHAIR" } },
    select: { panelId: true },
  });
  return [...new Set(grants.flatMap((grant) => (grant.panelId ? [grant.panelId] : [])))];
}

async function stepCounts(tx: Tx, facts: StepFacts, scope: ReportScope): Promise<StepCount[]> {
  const panel = scope.kind === "panels" ? Prisma.sql`AND p.panel_id IN (${Prisma.join(scope.panelIds)})` : Prisma.empty;
  const rows = await tx.$queryRaw<{ step: string; review_type: string | null; n: number }[]>`
    SELECT step, p.review_type::text AS review_type, count(*)::int AS n
    FROM workflow_instances wi
    JOIN protocols p ON p.id = wi.protocol_id
    CROSS JOIN LATERAL unnest(wi.current_step_keys) AS step
    WHERE wi.status = 'RUNNING'
    ${panel}
    GROUP BY step, p.review_type
    ORDER BY step ASC, p.review_type ASC
  `;
  return rows.map((row) => {
    const reviewType = row.review_type && REVIEW_TYPES.includes(row.review_type as ReviewType) ? row.review_type : "";
    const params = new URLSearchParams({ step: row.step });
    if (reviewType) params.set("reviewType", reviewType);
    return {
      key: row.step,
      name: facts.name(row.step),
      reviewType: reviewType || "Not set",
      count: Number(row.n),
      href: `/app/reports?${params.toString()}`,
    };
  });
}

async function reviewerLoad(tx: Tx, panelIds: string[]): Promise<LoadRow[]> {
  if (panelIds.length === 0) return [];
  const grouped = await tx.task.groupBy({
    by: ["assigneeUserId"],
    where: {
      status: { in: [...OPEN] },
      assigneeUserId: { not: null },
      instance: { status: "RUNNING", protocol: { panelId: { in: panelIds } } },
      candidateRule: { path: ["kind"], equals: "ASSIGNED_IN_STEP" },
    },
    _count: { _all: true },
  });
  const ids = grouped.flatMap((row) => (row.assigneeUserId ? [row.assigneeUserId] : []));
  const users = await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return grouped
    .flatMap((row) => {
      if (!row.assigneeUserId) return [];
      return [{ userId: row.assigneeUserId, name: names.get(row.assigneeUserId) ?? "Reviewer", open: row._count._all }];
    })
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
}

async function overdueBucket(tx: Tx, facts: StepFacts, holidays: Set<string>, now: Date, panelIds: string[] | null): Promise<Bucket> {
  const where = {
    status: { in: [...OPEN] },
    dueAt: { lt: now },
    instance: panelIds ? { protocol: { panelId: { in: panelIds.length ? panelIds : ["__none__"] } } } : { isNot: null },
  };
  const [total, tasks] = await Promise.all([
    tx.task.count({ where }),
    tx.task.findMany({ where, ...taskQuery, orderBy: { dueAt: "asc" }, take: PREVIEW }),
  ]);
  return { total, rows: tasks.flatMap((task) => { const row = toQueueRow(task, facts, holidays, now, new Set(facts.revisionKeys)); return row ? [row] : []; }) };
}

export async function listStepQueue(userId: string, kind: "screening" | "release" | "overdue", page: number) {
  return readTransaction(async (tx) => {
    await pinAppSchema(tx);
    const { secretariatOrThrow } = await import("@/server/reports/access");
    if (kind !== "overdue") await secretariatOrThrow(tx, userId);
    else {
      const scope = await reportScope(tx, userId);
      if (scope.kind === "panels") return listPanelOverdue(tx, userId, page, scope.panelIds);
    }
    const facts = await stepFacts(tx);
    const holidays = await holidaySet(tx);
    const now = new Date();
    const keys = kind === "screening" ? facts.screeningKeys : kind === "release" ? facts.releaseKeys : null;
    const where = keys
      ? { status: { in: [...OPEN] }, kind: "MAIN" as const, stepKey: { in: keys.length ? keys : ["__none__"] }, instance: { status: "RUNNING" as const } }
      : { status: { in: [...OPEN] }, dueAt: { lt: now }, instanceId: { not: null } };
    return pageTasks(tx, where, facts, holidays, now, kind === "overdue" ? { dueAt: "asc" } : { createdAt: "asc" }, page);
  });
}

async function listPanelOverdue(tx: Tx, userId: string, page: number, panelIds: string[]) {
  const facts = await stepFacts(tx);
  const holidays = await holidaySet(tx);
  const now = new Date();
  void userId;
  const panel = constrainPanel({ kind: "panels", panelIds }, undefined);
  return pageTasks(
    tx,
    { status: { in: [...OPEN] }, dueAt: { lt: now }, instance: { protocol: { panelId: panel } } },
    facts,
    holidays,
    now,
    { dueAt: "asc" },
    page,
  );
}

const PAGE_SIZE = 25;

async function pageTasks(
  tx: Tx,
  where: PrismaTypes.TaskWhereInput,
  facts: StepFacts,
  holidays: Set<string>,
  now: Date,
  orderBy: PrismaTypes.TaskOrderByWithRelationInput,
  page: number,
) {
  const current = Number.isInteger(page) && page > 0 ? page : 1;
  const total = await tx.task.count({ where });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safe = Math.min(current, pages);
  const tasks = await tx.task.findMany({
    where,
    ...taskQuery,
    orderBy,
    skip: (safe - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return {
    total,
    page: safe,
    pages,
    rows: tasks.flatMap((task) => {
      const row = toQueueRow(task, facts, holidays, now, new Set(facts.revisionKeys));
      return row ? [row] : [];
    }),
  };
}
