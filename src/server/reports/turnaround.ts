import "server-only";
import { Prisma, type Prisma as PrismaTypes, type ReviewType } from "@prisma/client";
import { calendarDaysBetween } from "@/lib/reports/days";
import { summarizeTurnaround, type TurnaroundSample, type TurnaroundSummary } from "@/lib/reports/metrics";
import type { ReportScope } from "@/server/reports/access";
import type { StepFacts } from "@/server/reports/steps";

const REVIEW: ReadonlySet<string> = new Set(["EXEMPT", "EXPEDITED", "FULL"]);

export type TurnaroundPair = TurnaroundSample & { versionId: string };

export async function turnaroundSamples(
  tx: PrismaTypes.TransactionClient,
  facts: StepFacts,
  scope: ReportScope | { kind: "versions"; versionIds: string[] },
): Promise<TurnaroundPair[]> {
  if (facts.screeningKeys.length === 0 || facts.releaseKeys.length === 0) return [];
  if (scope.kind === "panels" && scope.panelIds.length === 0) return [];
  if (scope.kind === "versions" && scope.versionIds.length === 0) return [];
  const outcome =
    facts.acceptOutcomes.length > 0
      ? Prisma.sql`AND t.outcome IN (${Prisma.join(facts.acceptOutcomes)})`
      : Prisma.empty;
  const scopeSql =
    scope.kind === "all"
      ? Prisma.empty
      : scope.kind === "panels"
        ? Prisma.sql`AND p.panel_id IN (${Prisma.join(scope.panelIds)})`
        : Prisma.sql`AND s.protocol_version_id IN (${Prisma.join(scope.versionIds)})`;
  const rows = await tx.$queryRaw<{ protocol_version_id: string; review_type: string; started: Date; released: Date }[]>`
    SELECT s.protocol_version_id, p.review_type::text AS review_type, s.completed_at AS started, r.released
    FROM (
      SELECT wi.id AS instance_id, wi.protocol_id, wi.protocol_version_id, t.completed_at
      FROM tasks t
      JOIN workflow_instances wi ON wi.id = t.instance_id
      WHERE t.status = 'COMPLETED'
        AND t.completed_at IS NOT NULL
        AND t.step_key IN (${Prisma.join(facts.screeningKeys)})
        ${outcome}
    ) s
    JOIN LATERAL (
      SELECT min(t.completed_at) AS released
      FROM tasks t
      WHERE t.instance_id = s.instance_id
        AND t.status = 'COMPLETED'
        AND t.completed_at IS NOT NULL
        AND t.completed_at >= s.completed_at
        AND t.step_key IN (${Prisma.join(facts.releaseKeys)})
    ) r ON r.released IS NOT NULL
    JOIN protocols p ON p.id = s.protocol_id
    WHERE p.review_type IS NOT NULL
    ${scopeSql}
  `;
  return rows.flatMap((row) => {
    if (!REVIEW.has(row.review_type)) return [];
    return [{
      versionId: row.protocol_version_id,
      reviewType: row.review_type as ReviewType,
      days: calendarDaysBetween(new Date(row.started), new Date(row.released)),
    }];
  });
}

export async function turnaroundSummary(
  tx: PrismaTypes.TransactionClient,
  facts: StepFacts,
  scope: ReportScope | { kind: "versions"; versionIds: string[] },
): Promise<TurnaroundSummary[]> {
  return summarizeTurnaround(await turnaroundSamples(tx, facts, scope));
}
