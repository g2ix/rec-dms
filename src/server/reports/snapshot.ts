import "server-only";
import type { Prisma as PrismaTypes } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { identityCtes, openTaskPredicate } from "@/server/workflow/inbox";

type Tx = PrismaTypes.TransactionClient;

const PREVIEW = 8;

export type StepPreview = { step: string; n: number; preview: { id: string; at: string }[] };

export type StaffPack = {
  graphs: unknown[];
  holidays: string[];
  receipts: number;
  pendingUsers: number;
  overdue: number;
  overdueIds: string[];
  waiting: number;
  waitingIds: string[];
  steps: StepPreview[];
};

export type ChairPack = {
  graphs: unknown[];
  holidays: string[];
  all: boolean;
  panelIds: string[];
  overdue: number;
  waiting: number;
  waitingIds: string[];
  pipeline: { step: string; reviewType: string | null; n: number }[];
};

function readPack<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/**
 * Staff dashboard counts and the ids for each preview, in one statement.
 * Per-step previews keep the eight earliest tasks, which is enough to rebuild a merged queue.
 */
export async function staffPack(tx: Tx, userId: string, now: Date): Promise<StaffPack> {
  const rows = await tx.$queryRaw<{ pack: unknown }[]>`
    WITH ${identityCtes(userId)},
    open_match AS (
      SELECT t.id, t.due_at, t.created_at
      FROM tasks t
      JOIN workflow_instances wi ON wi.id = t.instance_id
      JOIN protocols p ON p.id = wi.protocol_id
      WHERE ${openTaskPredicate(userId, "staff" satisfies RoleView)}
    )
    SELECT jsonb_build_object(
      'graphs', COALESCE((
        SELECT jsonb_agg(graph ORDER BY published_at ASC NULLS LAST)
        FROM workflow_versions WHERE status::text = 'PUBLISHED'
      ), '[]'::jsonb),
      'holidays', COALESCE((
        SELECT jsonb_agg(to_char(date, 'YYYY-MM-DD') ORDER BY date)
        FROM holidays
      ), '[]'::jsonb),
      'receipts', (SELECT count(*)::int FROM fee_verifications WHERE status::text = 'PENDING'),
      'pendingUsers', (SELECT count(*)::int FROM users WHERE status::text = 'PENDING_APPROVAL'),
      'overdue', (
        SELECT count(*)::int FROM tasks
        WHERE status IN ('OPEN', 'CLAIMED') AND due_at < ${now} AND instance_id IS NOT NULL
      ),
      'overdueIds', to_jsonb(ARRAY(
        SELECT id FROM tasks
        WHERE status IN ('OPEN', 'CLAIMED') AND due_at < ${now} AND instance_id IS NOT NULL
        ORDER BY due_at ASC, id ASC
        LIMIT ${PREVIEW}
      )),
      'waiting', (SELECT count(*)::int FROM open_match),
      'waitingIds', to_jsonb(ARRAY(
        SELECT id FROM open_match
        ORDER BY due_at ASC NULLS FIRST, created_at ASC, id ASC
        LIMIT ${PREVIEW}
      )),
      'steps', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('step', step_key, 'n', n, 'preview', preview))
        FROM (
          SELECT t.step_key, count(*)::int AS n,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', id, 'at', created_at) ORDER BY created_at ASC, id ASC)
              FROM (
                SELECT t2.id, t2.created_at
                FROM tasks t2
                JOIN workflow_instances wi2 ON wi2.id = t2.instance_id
                WHERE t2.status IN ('OPEN', 'CLAIMED') AND t2.kind = 'MAIN'
                  AND wi2.status::text = 'RUNNING' AND t2.step_key = t.step_key
                ORDER BY t2.created_at ASC, t2.id ASC
                LIMIT ${PREVIEW}
              ) earliest
            ), '[]'::jsonb) AS preview
          FROM tasks t
          JOIN workflow_instances wi ON wi.id = t.instance_id
          WHERE t.status IN ('OPEN', 'CLAIMED') AND t.kind = 'MAIN' AND wi.status::text = 'RUNNING'
          GROUP BY t.step_key
        ) grouped
      ), '[]'::jsonb)
    ) AS pack
  `;
  return readPack<StaffPack>(rows[0]?.pack ?? {});
}

/** Chair pipeline, overdue, and the personal queue, in one statement. */
export async function chairPack(tx: Tx, userId: string, now: Date): Promise<ChairPack> {
  const rows = await tx.$queryRaw<{ pack: unknown }[]>`
    WITH ${identityCtes(userId)},
    open_match AS (
      SELECT t.id, t.due_at, t.created_at
      FROM tasks t
      JOIN workflow_instances wi ON wi.id = t.instance_id
      JOIN protocols p ON p.id = wi.protocol_id
      WHERE ${openTaskPredicate(userId, "chair" satisfies RoleView)}
    ),
    scope_panels AS (
      SELECT DISTINCT ur.panel_id
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${userId}
        AND ur.revoked_at IS NULL
        AND r.key = 'PANEL_CHAIR'
        AND ur.panel_id IS NOT NULL
    )
    SELECT jsonb_build_object(
      'graphs', COALESCE((
        SELECT jsonb_agg(graph ORDER BY published_at ASC NULLS LAST)
        FROM workflow_versions WHERE status::text = 'PUBLISHED'
      ), '[]'::jsonb),
      'holidays', COALESCE((
        SELECT jsonb_agg(to_char(date, 'YYYY-MM-DD') ORDER BY date)
        FROM holidays
      ), '[]'::jsonb),
      'all', EXISTS (
        SELECT 1 FROM keys
        WHERE key IN ('REC_STAFF', 'REC_CHAIR', 'SYSTEM_ADMIN', 'MEMBER_SECRETARY')
      ),
      'panelIds', COALESCE((SELECT jsonb_agg(panel_id) FROM scope_panels), '[]'::jsonb),
      'overdue', (
        SELECT count(*)::int FROM tasks
        WHERE status IN ('OPEN', 'CLAIMED') AND due_at < ${now} AND instance_id IS NOT NULL
      ),
      'waiting', (SELECT count(*)::int FROM open_match),
      'waitingIds', to_jsonb(ARRAY(
        SELECT id FROM open_match
        ORDER BY due_at ASC NULLS FIRST, created_at ASC, id ASC
        LIMIT ${PREVIEW}
      )),
      'pipeline', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('step', step, 'reviewType', review_type, 'n', n))
        FROM (
          SELECT step, p.review_type::text AS review_type, count(*)::int AS n
          FROM workflow_instances wi
          JOIN protocols p ON p.id = wi.protocol_id
          CROSS JOIN LATERAL unnest(wi.current_step_keys) AS step
          WHERE wi.status::text = 'RUNNING'
            AND (
              EXISTS (
                SELECT 1 FROM keys
                WHERE key IN ('REC_STAFF', 'REC_CHAIR', 'SYSTEM_ADMIN', 'MEMBER_SECRETARY')
              )
              OR p.panel_id IN (SELECT panel_id FROM scope_panels)
            )
          GROUP BY step, p.review_type
        ) counted
      ), '[]'::jsonb)
    ) AS pack
  `;
  return readPack<ChairPack>(rows[0]?.pack ?? {});
}
