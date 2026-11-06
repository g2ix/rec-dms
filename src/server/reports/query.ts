import "server-only";
import type { Prisma, ReviewType } from "@prisma/client";
import { csvDocument } from "@/lib/reports/csv";
import { withinLimit, type TurnaroundSummary } from "@/lib/reports/metrics";
import { manilaDayEnd, manilaDayStart } from "@/lib/time";
import { prisma, useAppSchema as pinAppSchema } from "@/server/db";
import { constrainPanel, reportScope } from "@/server/reports/access";
import { stepFacts } from "@/server/reports/steps";
import { turnaroundSamples, turnaroundSummary } from "@/server/reports/turnaround";

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 5000;
const REVIEW = new Set(["EXEMPT", "EXPEDITED", "FULL"]);

export type ReportFilters = {
  from?: string;
  to?: string;
  panelId?: string;
  reviewType?: string;
  status?: string;
  submissionType?: string;
  step?: string;
  page?: number;
};

export type ReportRow = {
  versionId: string;
  protocolId: string;
  code: string | null;
  title: string;
  panel: string;
  reviewType: string;
  status: string;
  submissionType: string;
  submittedAt: Date | null;
  days: number | null;
  within: string;
  decision: string;
};

function one(input: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = input[key];
  const text = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return text || undefined;
}

export function parseReportFilters(input: Record<string, string | string[] | undefined>): ReportFilters {
  const from = one(input, "from");
  const to = one(input, "to");
  const page = Number(one(input, "page") ?? "1");
  const reviewType = one(input, "reviewType");
  return {
    from: from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined,
    to: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : undefined,
    panelId: one(input, "panel"),
    reviewType: reviewType && REVIEW.has(reviewType) ? reviewType : undefined,
    status: one(input, "status"),
    submissionType: one(input, "submission"),
    step: one(input, "step"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export async function loadReport(userId: string, filters: ReportFilters) {
  return prisma.$transaction(async (tx) => reportIn(tx, userId, filters), { timeout: 20_000 });
}

export async function reportCsv(userId: string, filters: ReportFilters): Promise<string> {
  const report = await loadReport(userId, { ...filters, page: 1 });
  const header = ["code", "title", "panel", "review_type", "status", "submission_type", "submitted_at", "decision", "turnaround_days", "within_limit"];
  const lines = report.exportRows.map((row) => [
    row.code ?? "",
    row.title,
    row.panel,
    row.reviewType,
    row.status,
    row.submissionType,
    row.submittedAt ? row.submittedAt.toISOString() : "",
    row.decision,
    row.days ?? "",
    row.within,
  ]);
  return csvDocument(header, lines);
}

async function reportIn(tx: Prisma.TransactionClient, userId: string, filters: ReportFilters) {
  await pinAppSchema(tx);
  const scope = await reportScope(tx, userId);
  const panelId = constrainPanel(scope, filters.panelId);
  const facts = await stepFacts(tx);
  const where = versionWhere(filters, panelId);
  const versions = await tx.protocolVersion.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    take: EXPORT_LIMIT,
    select: {
      id: true,
      submittedAt: true,
      protocol: { select: { id: true, code: true, title: true, status: true, reviewType: true, panel: { select: { id: true, name: true } } } },
      workflowInstances: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: { version: { select: { definition: { select: { submissionType: true } } } } },
      },
    },
  });
  const versionIds = versions.map((version) => version.id);
  const [pairs, decisions, panels] = await Promise.all([
    turnaroundSamples(tx, facts, { kind: "versions", versionIds }),
    decisionCounts(tx, facts.decisionKeys, versionIds),
    tx.panel.findMany({
      where: scope.kind === "panels" ? { id: { in: scope.panelIds } } : { active: true },
      select: { id: true, name: true, code: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const daysOf = new Map(pairs.map((pair) => [pair.versionId, pair]));
  const decisionOf = await decisionByVersion(tx, facts, versionIds);
  const rows = versions.map((version) => {
    const pair = daysOf.get(version.id);
    const reviewType = version.protocol.reviewType;
    const within = pair && reviewType ? (withinLimit(pair.days, reviewType) ? "Yes" : "No") : "";
    return {
      versionId: version.id,
      protocolId: version.protocol.id,
      code: version.protocol.code,
      title: version.protocol.title,
      panel: version.protocol.panel?.name ?? "",
      reviewType: reviewType ?? "",
      status: version.protocol.status,
      submissionType: version.workflowInstances[0]?.version.definition.submissionType ?? "",
      submittedAt: version.submittedAt,
      days: pair?.days ?? null,
      within,
      decision: decisionOf.get(version.id) ?? "",
    } satisfies ReportRow;
  });
  const page = Math.min(filters.page ?? 1, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const turnaround: TurnaroundSummary[] = await turnaroundSummary(tx, facts, { kind: "versions", versionIds });
  return {
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    exportRows: rows,
    total: rows.length,
    page,
    pages: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    submissions: rows.length,
    decisions: decisions.map((row) => ({ outcome: row.outcome ?? "", label: facts.outcomeLabel(row.outcome ?? ""), count: row._count._all })),
    turnaround,
    panels,
    filters,
  };
}

function versionWhere(filters: ReportFilters, panelId: string | { in: string[] } | undefined): Prisma.ProtocolVersionWhereInput {
  const submittedAt = filters.from || filters.to
    ? {
        ...(filters.from ? { gte: manilaDayStart(filters.from) } : {}),
        ...(filters.to ? { lte: manilaDayEnd(filters.to) } : {}),
      }
    : { not: null };
  return {
    submittedAt,
    protocol: {
      ...(panelId ? { panelId } : {}),
      ...(filters.reviewType ? { reviewType: filters.reviewType as ReviewType } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.step
        ? { workflowInstances: { some: { status: "RUNNING", currentStepKeys: { has: filters.step } } } }
        : {}),
    },
    ...(filters.submissionType
      ? { workflowInstances: { some: { version: { definition: { submissionType: filters.submissionType } } } } }
      : {}),
  };
}

async function decisionCounts(tx: Prisma.TransactionClient, keys: string[], versionIds: string[]) {
  if (keys.length === 0 || versionIds.length === 0) return [];
  return tx.task.groupBy({
    by: ["outcome"],
    where: { status: "COMPLETED", outcome: { not: null }, stepKey: { in: keys }, instance: { protocolVersionId: { in: versionIds } } },
    _count: { _all: true },
  });
}

async function decisionByVersion(tx: Prisma.TransactionClient, facts: Awaited<ReturnType<typeof stepFacts>>, versionIds: string[]) {
  const map = new Map<string, string>();
  if (facts.decisionKeys.length === 0 || versionIds.length === 0) return map;
  const tasks = await tx.task.findMany({
    where: { status: "COMPLETED", outcome: { not: null }, stepKey: { in: facts.decisionKeys }, instance: { protocolVersionId: { in: versionIds } } },
    select: { outcome: true, completedAt: true, instance: { select: { protocolVersionId: true } } },
    orderBy: { completedAt: "desc" },
  });
  for (const task of tasks) {
    const versionId = task.instance?.protocolVersionId;
    if (!versionId || map.has(versionId) || !task.outcome) continue;
    map.set(versionId, facts.outcomeLabel(task.outcome));
  }
  return map;
}
