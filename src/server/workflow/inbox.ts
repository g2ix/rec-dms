import "server-only";
import { Prisma, type Prisma as PrismaTypes } from "@prisma/client";
import type { RoleView } from "@/lib/role-view";
import { VIEW_KIND, VIEW_ROLES } from "@/lib/workflow/views";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";
import { prisma, useAppSchema } from "@/server/db";

type Tx = PrismaTypes.TransactionClient;

/** Granted role keys, plus bootstrap extras, resolved inside the same statement as the task filter. */
export function identityCtes(userId: string): Prisma.Sql {
  const emails = bootstrapAdminEmails();
  const bootstrap = emails.length
    ? Prisma.sql`EXISTS (
        SELECT 1 FROM user_emails e
        WHERE e.user_id = ${userId} AND e.verified_at IS NOT NULL AND e.email IN (${Prisma.join(emails)})
      )`
    : Prisma.sql`FALSE`;
  return Prisma.sql`
    granted AS (
      SELECT r.key
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ${userId} AND ur.revoked_at IS NULL
    ),
    keys AS (
      SELECT key FROM granted
      UNION
      SELECT b.key FROM (VALUES ('REC_STAFF'), ('SYSTEM_ADMIN')) AS b(key)
      WHERE ${bootstrap}
    ),
    extras AS (
      SELECT key FROM keys
      EXCEPT
      SELECT key FROM granted
    )
  `;
}

/** Same rows as `taskMatchesView` plus `userMatchesRule`. Requires `identityCtes` and aliases t, wi, p. */
export function openTaskPredicate(userId: string, view: RoleView | "all"): Prisma.Sql {
  const viewMatch =
    view === "all"
      ? Prisma.sql`TRUE`
      : Prisma.sql`(
          t.candidate_rule->>'kind' = 'USER'
          OR (
            t.candidate_rule->>'kind' IN ('ROLE', 'PANEL_ROLE_OF_PROTOCOL')
            AND ${textIn(Prisma.sql`t.candidate_rule->>'role'`, VIEW_ROLES[view])}
          )
          OR (
            t.candidate_rule->>'kind' NOT IN ('ROLE', 'PANEL_ROLE_OF_PROTOCOL')
            AND ${textIn(Prisma.sql`t.candidate_rule->>'kind'`, VIEW_KIND[view])}
          )
        )`;
  return Prisma.sql`
    t.status IN ('OPEN', 'CLAIMED')
    AND t.step_key IS NOT NULL
    AND (t.assignee_user_id = ${userId} OR t.assignee_user_id IS NULL)
    AND ${viewMatch}
    AND (
      t.assignee_user_id = ${userId}
      OR (
        t.assignee_user_id IS NULL
        AND (
          (t.candidate_rule->>'kind' = 'PROTOCOL_LEADER' AND p.leader_user_id = ${userId})
          OR (
            t.candidate_rule->>'kind' = 'PROTOCOL_PROPONENTS'
            AND EXISTS (
              SELECT 1 FROM protocol_members m
              WHERE m.protocol_id = p.id AND m.user_id = ${userId}
                AND m.status = 'ACTIVE' AND m.role = 'PROPONENT'
            )
          )
          OR (
            t.candidate_rule->>'kind' = 'PROTOCOL_ADVISER'
            AND EXISTS (
              SELECT 1 FROM protocol_members m
              WHERE m.protocol_id = p.id AND m.user_id = ${userId}
                AND m.status = 'ACTIVE' AND m.role = 'ADVISER'
            )
          )
          OR (
            t.candidate_rule->>'kind' = 'ROLE'
            AND t.candidate_rule->>'role' IN (SELECT key FROM keys)
          )
          OR (
            t.candidate_rule->>'kind' = 'PANEL_ROLE_OF_PROTOCOL'
            AND (
              t.candidate_rule->>'role' IN (SELECT key FROM extras)
              OR EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = ${userId}
                  AND ur.revoked_at IS NULL
                  AND r.key = t.candidate_rule->>'role'
                  AND (ur.panel_id IS NULL OR ur.panel_id = p.panel_id)
              )
            )
          )
          OR (
            t.candidate_rule->>'kind' = 'ASSIGNED_IN_STEP'
            AND EXISTS (
              SELECT 1 FROM jsonb_each(wi.assignments) AS entry(key, value)
              WHERE entry.key = t.candidate_rule->>'stepKey'
                AND jsonb_typeof(entry.value) = 'array'
                AND jsonb_exists(entry.value, ${userId})
            )
          )
          OR (t.candidate_rule->>'kind' = 'USER' AND t.candidate_rule->>'userId' = ${userId})
        )
      )
    )
  `;
}

function textIn(column: Prisma.Sql, values: string[]): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${column} IN (${Prisma.join(values)})`;
}

/**
 * Open tasks for one person and role view.
 * The filter matches `taskMatchesView` and `userMatchesRule` without loading every open task.
 */
export async function openTasks(
  tx: Tx,
  userId: string,
  view: RoleView | "all",
  limit?: number,
): Promise<{ total: number; ids: string[] }> {
  const limited = limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty;
  const rows = await tx.$queryRaw<{ id: string; total: number }[]>`
    WITH ${identityCtes(userId)}
    SELECT id, total FROM (
      SELECT t.id, count(*) OVER () AS total, t.due_at, t.created_at
      FROM tasks t
      JOIN workflow_instances wi ON wi.id = t.instance_id
      JOIN protocols p ON p.id = wi.protocol_id
      WHERE ${openTaskPredicate(userId, view)}
    ) matched
    ORDER BY due_at ASC NULLS FIRST, created_at ASC, id ASC
    ${limited}
  `;
  const total = rows[0] ? Number(rows[0].total) : 0;
  return { total, ids: rows.map((row) => row.id) };
}

/** Open-task total for the role the person is viewing as. A slow pool leaves the nav without a count. */
export async function inboxTotal(userId: string, view: RoleView): Promise<number> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await useAppSchema(tx);
        const { total } = await openTasks(tx, userId, view, 1);
        return total;
      },
      { maxWait: 8_000, timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") return 0;
    throw error;
  }
}
