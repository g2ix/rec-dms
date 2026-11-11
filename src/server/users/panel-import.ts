import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { DEFAULT_MEMBER_ROLE, DEFAULT_ROLE_RULES, parseMemberSheet, sameAttributes, splitName, type ImportRow, type RoleRule } from "@/lib/panels/import";
import { readFirstSheet } from "@/lib/xlsx";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { createPerson } from "@/server/auth/users";
import { canManageUsers } from "@/server/authz/policy";
import { userAdminFacts } from "@/server/authz/user-admin";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const IMPORT_REASON = "Panel list import";

export type PlanItem =
  | { kind: "panel"; panelCode: string; panelName: string }
  | { kind: "new"; panelCode: string; name: string; email: string; roleKey: string; designation: string }
  | { kind: "grant"; panelCode: string; name: string; email: string; roleKey: string; designation: string }
  | { kind: "change"; panelCode: string; name: string; email: string; fromRole: string; roleKey: string; fromDesignation: string; designation: string }
  | { kind: "remove"; panelCode: string; name: string; roleKey: string; grantId: string }
  | { kind: "skip"; sheetRow: number; reason: string };

async function roleRules(db: Db): Promise<RoleRule[]> {
  const value = await settingValue(db, "panels.importRoles");
  if (!Array.isArray(value)) return DEFAULT_ROLE_RULES;
  const rules = value.filter(
    (item): item is RoleRule => Boolean(item) && typeof (item as RoleRule).match === "string" && typeof (item as RoleRule).role === "string",
  );
  return rules.length > 0 ? rules : DEFAULT_ROLE_RULES;
}

export async function parseWorkbook(bytes: Uint8Array) {
  let sheet;
  try {
    sheet = readFirstSheet(bytes);
  } catch {
    throw new AppError("INVALID", "That file is not a readable .xlsx workbook.", 400);
  }
  try {
    return parseMemberSheet(sheet, await roleRules(prisma));
  } catch (error) {
    throw new AppError("INVALID", error instanceof Error ? error.message : "The sheet layout was not recognised.", 400);
  }
}

function attrs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function panelRoleKeys(db: Db): Promise<string[]> {
  const rules = await roleRules(db);
  return [...new Set([...rules.map((rule) => rule.role), DEFAULT_MEMBER_ROLE])];
}

async function userFor(db: Db, row: ImportRow): Promise<{ id: string; displayName: string } | null> {
  const emails = [row.email, row.extraEmail].filter((item): item is string => Boolean(item));
  const found = await db.userEmail.findFirst({ where: { email: { in: emails } }, include: { user: { select: { id: true, displayName: true, status: true } } } });
  if (!found || found.user.status === "MERGED") return null;
  return { id: found.user.id, displayName: found.user.displayName };
}

/** What an import would change. Nothing is written. */
export async function planImport(db: Db, rows: ImportRow[], skipped: { sheetRow: number; reason: string }[] = []): Promise<PlanItem[]> {
  const items: PlanItem[] = skipped.map((item) => ({ kind: "skip" as const, ...item }));
  const keys = await panelRoleKeys(db);
  const codes = [...new Set(rows.map((row) => row.panelCode))];
  for (const code of codes) {
    const panel = await db.panel.findUnique({ where: { code } });
    const panelRows = rows.filter((row) => row.panelCode === code);
    if (!panel) items.push({ kind: "panel", panelCode: code, panelName: panelRows[0]?.panelName ?? code });
    const grants = panel
      ? await db.userRole.findMany({
          where: { panelId: panel.id, revokedAt: null, role: { key: { in: keys } } },
          include: { role: { select: { key: true } }, user: { select: { displayName: true } } },
        })
      : [];
    const listed = new Set<string>();
    for (const row of panelRows) {
      const user = await userFor(db, row);
      if (!user) {
        items.push({ kind: "new", panelCode: code, name: row.name, email: row.email ?? "", roleKey: row.roleKey, designation: row.attributes.designation });
        continue;
      }
      if (listed.has(user.id)) continue;
      listed.add(user.id);
      const current = grants.find((grant) => grant.userId === user.id);
      if (!current) {
        items.push({ kind: "grant", panelCode: code, name: user.displayName, email: row.email ?? "", roleKey: row.roleKey, designation: row.attributes.designation });
      } else if (current.role.key !== row.roleKey || !sameAttributes(current.attributes, row.attributes)) {
        items.push({
          kind: "change",
          panelCode: code,
          name: user.displayName,
          email: row.email ?? "",
          fromRole: current.role.key,
          roleKey: row.roleKey,
          fromDesignation: String(attrs(current.attributes).designation ?? ""),
          designation: row.attributes.designation,
        });
      }
    }
    for (const grant of grants) {
      if (!listed.has(grant.userId)) items.push({ kind: "remove", panelCode: code, name: grant.user.displayName, roleKey: grant.role.key, grantId: grant.id });
    }
    // A person with two panel grants on the same panel keeps one; the extra goes.
    const seen = new Set<string>();
    for (const grant of grants) {
      if (!listed.has(grant.userId)) continue;
      if (seen.has(grant.userId)) items.push({ kind: "remove", panelCode: code, name: grant.user.displayName, roleKey: grant.role.key, grantId: grant.id });
      seen.add(grant.userId);
    }
  }
  return items;
}

export async function assertPanelManager(actorUserId: string) {
  if (!canManageUsers(await userAdminFacts(actorUserId))) throw new AppError("FORBIDDEN", "Only REC Staff or a System Admin can import panel members.", 403);
}

/**
 * Applies an import: creates missing panels and accounts, grants and changes panel roles, and
 * revokes grants of people no longer listed with the reason "Panel list import". Open tasks are
 * not moved. Running it again with the same rows changes nothing.
 */
export async function applyImport(input: { rows: ImportRow[]; actorUserId: string }) {
  await assertPanelManager(input.actorUserId);
  const meta = await auditRequestMeta({});
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(2142041, 2)`;
      const plan = await planImport(tx, input.rows);
      const keys = await panelRoleKeys(tx);
      const roles = new Map((await tx.role.findMany({ where: { key: { in: keys } } })).map((role) => [role.key, role]));
      for (const key of keys) if (!roles.has(key)) throw new AppError("INVALID", `The role ${key} is not set up. Run the seed first.`, 409);
      const panels = new Map<string, string>();
      for (const item of plan) {
        if (item.kind !== "panel") continue;
        const panel = await tx.panel.create({ data: { code: item.panelCode, name: item.panelName } });
        panels.set(item.panelCode, panel.id);
      }
      for (const code of new Set(input.rows.map((row) => row.panelCode))) {
        if (!panels.has(code)) panels.set(code, (await tx.panel.findUniqueOrThrow({ where: { code } })).id);
      }
      const revoke = async (grant: { id: string; userId: string; panelId: string | null; roleKey: string }) => {
        await tx.userRole.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
        await audit.record(tx, {
          actorUserId: input.actorUserId,
          action: AuditAction.roleRevoked,
          entityType: "user",
          entityId: grant.userId,
          diff: diffOf({ role: grant.roleKey, userRoleId: grant.id }, { reason: IMPORT_REASON }),
          meta,
        });
      };
      for (const item of plan) {
        if (item.kind !== "remove") continue;
        const grant = await tx.userRole.findUniqueOrThrow({ where: { id: item.grantId } });
        await revoke({ id: grant.id, userId: grant.userId, panelId: grant.panelId, roleKey: item.roleKey });
      }
      const counts = { panels: 0, accounts: 0, granted: 0, changed: 0, removed: plan.filter((item) => item.kind === "remove").length };
      counts.panels = plan.filter((item) => item.kind === "panel").length;
      const done = new Set<string>();
      for (const row of input.rows) {
        const panelId = panels.get(row.panelCode)!;
        let user = await userFor(tx, row);
        if (!user) {
          const parts = splitName(row.name);
          const created = await createPerson(
            {
              firstName: parts.firstName,
              middleInitial: parts.middleInitial,
              familyName: parts.familyName,
              title: parts.title,
              credentials: parts.credentials,
              email: row.email!,
              status: "ACTIVE",
            },
            tx,
          );
          user = { id: created.id, displayName: created.displayName };
          counts.accounts += 1;
          await tx.job.create({
            data: {
              kind: "NOTIFY",
              payload: toJson({ templateKey: "panel.added", userIds: [created.id], variables: { reason: row.panelName } }),
              runAt: new Date(),
            },
          });
        }
        const once = `${panelId}:${user.id}`;
        if (done.has(once)) continue;
        done.add(once);
        const role = roles.get(row.roleKey);
        if (!role) throw new AppError("INVALID", `The role ${row.roleKey} is not set up.`, 409);
        const current = await tx.userRole.findFirst({
          where: { userId: user.id, panelId, revokedAt: null, role: { key: { in: keys } } },
          include: { role: { select: { key: true } } },
        });
        if (current && current.role.key === row.roleKey) {
          if (!sameAttributes(current.attributes, row.attributes)) {
            await tx.userRole.update({ where: { id: current.id }, data: { attributes: toJson(row.attributes) } });
            await audit.record(tx, {
              actorUserId: input.actorUserId,
              action: AuditAction.roleGranted,
              entityType: "user",
              entityId: user.id,
              diff: diffOf({ attributes: toJson(current.attributes) }, { attributes: toJson(row.attributes), userRoleId: current.id, reason: IMPORT_REASON }),
              meta,
            });
            counts.changed += 1;
          }
          continue;
        }
        if (current) {
          await revoke({ id: current.id, userId: user.id, panelId, roleKey: current.role.key });
          counts.changed += 1;
        } else counts.granted += 1;
        const grant = await tx.userRole.create({
          data: { userId: user.id, roleId: role.id, panelId, grantedById: input.actorUserId, attributes: toJson(row.attributes) },
        });
        await audit.record(tx, {
          actorUserId: input.actorUserId,
          action: AuditAction.roleGranted,
          entityType: "user",
          entityId: user.id,
          diff: diffOf({}, { role: row.roleKey, panel: row.panelCode, userRoleId: grant.id, reason: IMPORT_REASON }),
          meta,
        });
      }
      await audit.record(tx, {
        actorUserId: input.actorUserId,
        action: AuditAction.panelImported,
        entityType: "panel",
        entityId: [...panels.keys()].join(","),
        diff: counts,
        meta,
      });
      return counts;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
