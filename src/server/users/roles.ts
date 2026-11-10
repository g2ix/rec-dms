import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { actsAsSystemAdmin, canManageUsers } from "@/server/authz/policy";
import { ACTIVE_SYSTEM_ADMIN, userAdminFacts } from "@/server/authz/user-admin";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

type Tx = Prisma.TransactionClient;
type AuditMeta = Awaited<ReturnType<typeof auditRequestMeta>>;

const SYSTEM_ADMIN = "SYSTEM_ADMIN";
const PANEL_CHAIR = "PANEL_CHAIR";
const LIST_LIMIT = 50;

function forbidden(message: string): AppError {
  return new AppError("FORBIDDEN", message, 403);
}

function invalid(message: string): AppError {
  return new AppError("INVALID", message, 400);
}

/** Role changes check who else holds a role, so they run one at a time. */
async function lockRoleChanges(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(2142041, 2)`;
}

function roleTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await lockRoleChanges(tx);
      return run(tx);
    },
    { timeout: 20_000 },
  );
}

async function assertManager(tx: Tx, actorUserId: string) {
  const facts = await userAdminFacts(actorUserId, tx);
  if (!canManageUsers(facts)) throw forbidden("Only REC Staff or a System Admin can manage users.");
  return facts;
}

async function activeTarget(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, status: true, displayName: true } });
  if (!user || user.status === "MERGED") throw new AppError("NOT_FOUND", "That account was not found.", 404);
  if (user.status !== "ACTIVE") throw invalid("Only an active account can be given a role.");
  return user;
}

async function activePanel(tx: Tx, panelId: string) {
  const panel = await tx.panel.findUnique({ where: { id: panelId }, select: { id: true, code: true, name: true, active: true } });
  if (!panel || !panel.active) throw invalid("Choose an active panel.");
  return panel;
}

async function addGrant(
  tx: Tx,
  input: { actorUserId: string; userId: string; role: { id: string; key: string }; panel: { id: string; code: string } | null; meta: AuditMeta },
) {
  const grant = await tx.userRole.create({
    data: { userId: input.userId, roleId: input.role.id, panelId: input.panel?.id ?? null, grantedById: input.actorUserId },
  });
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: AuditAction.roleGranted,
    entityType: "user",
    entityId: input.userId,
    diff: diffOf({}, { role: input.role.key, panel: input.panel?.code ?? null, userRoleId: grant.id }),
    meta: input.meta,
  });
  return grant;
}

async function endGrant(
  tx: Tx,
  input: {
    actorUserId: string;
    grant: { id: string; userId: string; panelId: string | null };
    roleKey: string;
    reason: string;
    meta: AuditMeta;
  },
) {
  const { grant } = input;
  await tx.userRole.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  const panel = grant.panelId ? await tx.panel.findUnique({ where: { id: grant.panelId }, select: { code: true } }) : null;
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: AuditAction.roleRevoked,
    entityType: "user",
    entityId: grant.userId,
    diff: diffOf({ role: input.roleKey, panel: panel?.code ?? null, userRoleId: grant.id }, { reason: input.reason }),
    meta: input.meta,
  });
}

function currentChairs(tx: Tx, panelId: string) {
  return tx.userRole.findMany({
    where: { panelId, revokedAt: null, role: { key: PANEL_CHAIR } },
    include: { user: { select: { displayName: true } }, role: { select: { key: true } } },
  });
}

export async function grantRole(input: { actorUserId: string; userId: string; roleId: string; panelId: string | null }) {
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    const role = await tx.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw invalid("Choose a role.");
    if (role.scope === "PROTOCOL") throw invalid("This role is held through a protocol, not granted here.");
    if (role.key === SYSTEM_ADMIN && !actsAsSystemAdmin(facts)) {
      throw forbidden("Only a System Admin can grant System Admin.");
    }
    await activeTarget(tx, input.userId);

    let panel: { id: string; code: string } | null = null;
    if (role.scope === "PANEL") {
      if (!input.panelId) throw invalid(`Choose the panel for ${role.name}.`);
      panel = await activePanel(tx, input.panelId);
    } else if (input.panelId) {
      throw invalid(`${role.name} is not held per panel.`);
    }

    const existing = await tx.userRole.findFirst({
      where: { userId: input.userId, roleId: role.id, panelId: panel?.id ?? null, revokedAt: null },
      select: { id: true },
    });
    if (existing) throw invalid("This person already holds that role.");

    if (role.key === PANEL_CHAIR && panel) {
      const [chair] = await currentChairs(tx, panel.id);
      if (chair) throw invalid(`${chair.user.displayName} is the Panel Chair of this panel. Change the chair on the Panels page.`);
    }

    return addGrant(tx, { actorUserId: input.actorUserId, userId: input.userId, role, panel, meta });
  });
}

export async function revokeRole(input: { actorUserId: string; userRoleId: string; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw invalid("Enter the reason for revoking this role.");
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    const grant = await tx.userRole.findUnique({ where: { id: input.userRoleId }, include: { role: { select: { key: true } } } });
    if (!grant || grant.revokedAt) throw new AppError("NOT_FOUND", "That role is no longer active.", 404);

    if (grant.role.key === SYSTEM_ADMIN) {
      if (!actsAsSystemAdmin(facts)) throw forbidden("Only a System Admin can revoke System Admin.");
      const other = await tx.userRole.findFirst({
        where: { ...ACTIVE_SYSTEM_ADMIN, userId: { not: grant.userId } },
        select: { id: true },
      });
      if (!other) throw invalid("This is the last System Admin. Grant the role to someone else first.");
    }

    await endGrant(tx, { actorUserId: input.actorUserId, grant, roleKey: grant.role.key, reason, meta });
    return { userId: grant.userId };
  });
}

/** Replaces the panel's chair in one transaction: one revoked event per old chair, one granted event. */
export async function changePanelChair(input: { actorUserId: string; panelId: string; newChairUserId: string; reason: string }) {
  const reason = input.reason.trim();
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    await assertManager(tx, input.actorUserId);
    const panel = await activePanel(tx, input.panelId);
    const role = await tx.role.findUnique({ where: { key: PANEL_CHAIR } });
    if (!role) throw invalid("The Panel Chair role is not set up yet.");
    await activeTarget(tx, input.newChairUserId);

    const chairs = await currentChairs(tx, panel.id);
    const outgoing = chairs.filter((chair) => chair.userId !== input.newChairUserId);
    if (chairs.length > 0 && outgoing.length === 0) throw invalid("This person is already the Panel Chair.");
    if (outgoing.length > 0 && !reason) throw invalid("Enter the reason for changing the chair.");

    for (const grant of outgoing) {
      await endGrant(tx, { actorUserId: input.actorUserId, grant, roleKey: PANEL_CHAIR, reason, meta });
    }
    if (outgoing.length === chairs.length) {
      await addGrant(tx, { actorUserId: input.actorUserId, userId: input.newChairUserId, role, panel, meta });
    }
  });
}

/** A merge moves every role onto the kept account, so it could otherwise hand over System Admin. */
export async function assertMayMergeAccounts(actorUserId: string, userIds: string[]): Promise<void> {
  const holder = await prisma.userRole.findFirst({
    where: { userId: { in: userIds }, revokedAt: null, role: { key: SYSTEM_ADMIN } },
    select: { id: true },
  });
  if (holder && !actsAsSystemAdmin(await userAdminFacts(actorUserId))) {
    throw forbidden("Only a System Admin can merge a System Admin account.");
  }
}

export async function listUsersWithRoles(q: string) {
  const users = await prisma.user.findMany({
    where: {
      status: { not: "MERGED" },
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      emails: { where: { isContact: true } },
      roles: { where: { revokedAt: null }, include: { role: { select: { name: true } } } },
    },
    orderBy: { displayName: "asc" },
    take: LIST_LIMIT,
  });
  return users.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    email: user.emails[0]?.email ?? user.email ?? null,
    roles: [...new Set(user.roles.map((grant) => grant.role.name))].sort(),
  }));
}

export async function userRoleDetail(actorUserId: string, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      emails: { where: { isContact: true } },
      roles: { where: { revokedAt: null }, include: { role: true }, orderBy: { grantedAt: "asc" } },
    },
  });
  if (!user || user.status === "MERGED") return null;

  const [facts, roles, panels] = await Promise.all([
    userAdminFacts(actorUserId),
    prisma.role.findMany({ where: { scope: { not: "PROTOCOL" } }, orderBy: { name: "asc" } }),
    prisma.panel.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const canAdmin = actsAsSystemAdmin(facts);
  const panelIds = user.roles.flatMap((grant) => (grant.panelId ? [grant.panelId] : []));
  const granterIds = user.roles.flatMap((grant) => (grant.grantedById ? [grant.grantedById] : []));
  const [grantPanels, granters] = await Promise.all([
    prisma.panel.findMany({ where: { id: { in: panelIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, displayName: true } }),
  ]);
  const panelName = new Map(grantPanels.map((panel) => [panel.id, panel.name]));
  const granterName = new Map(granters.map((granter) => [granter.id, granter.displayName]));

  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    email: user.emails[0]?.email ?? user.email ?? null,
    grants: user.roles.map((grant) => ({
      id: grant.id,
      roleName: grant.role.name,
      panelName: grant.panelId ? (panelName.get(grant.panelId) ?? "Unknown panel") : null,
      grantedAt: grant.grantedAt,
      grantedBy: grant.grantedById ? (granterName.get(grant.grantedById) ?? null) : null,
      canRevoke: grant.role.key !== SYSTEM_ADMIN || canAdmin,
    })),
    options: {
      roles: roles
        .filter((role) => role.key !== SYSTEM_ADMIN || canAdmin)
        .map((role) => ({ id: role.id, name: role.name, perPanel: role.scope === "PANEL" })),
      panels,
    },
  };
}

function personRow(grant: { id: string; userId: string; panelId: string | null; user: { displayName: string }; role: { name: string } }) {
  return { id: grant.id, userId: grant.userId, name: grant.user.displayName, roleName: grant.role.name, allPanels: grant.panelId === null };
}

/** A chair grant with no panel counts for every panel, the same way the workflow engine reads it. */
export async function panelOverview() {
  const [panels, grants] = await Promise.all([
    prisma.panel.findMany({ orderBy: { code: "asc" }, include: { disciplines: { orderBy: { name: "asc" }, select: { name: true } } } }),
    prisma.userRole.findMany({
      where: { revokedAt: null, OR: [{ panelId: { not: null } }, { role: { key: PANEL_CHAIR } }] },
      include: { user: { select: { displayName: true } }, role: { select: { key: true, name: true } } },
    }),
  ]);
  return panels.map((panel) => ({
    id: panel.id,
    code: panel.code,
    name: panel.name,
    active: panel.active,
    disciplines: panel.disciplines.map((discipline) => discipline.name),
    chairs: grants.filter((grant) => grant.role.key === PANEL_CHAIR && (grant.panelId === panel.id || grant.panelId === null)).map(personRow),
    members: grants.filter((grant) => grant.role.key !== PANEL_CHAIR && grant.panelId === panel.id).map(personRow),
  }));
}

export async function panelChairChoices(panelId: string, q: string) {
  const panel = await prisma.panel.findUnique({ where: { id: panelId }, select: { id: true, code: true, name: true, active: true } });
  if (!panel) return null;
  const [chairs, candidates] = await Promise.all([
    prisma.userRole.findMany({
      where: { panelId, revokedAt: null, role: { key: PANEL_CHAIR } },
      include: { user: { select: { displayName: true } } },
    }),
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        ...(q
          ? {
              OR: [
                { displayName: { contains: q, mode: "insensitive" } },
                { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
              ],
            }
          : {}),
      },
      include: { emails: { where: { isContact: true } } },
      orderBy: { displayName: "asc" },
      take: LIST_LIMIT,
    }),
  ]);
  const currentIds = new Set(chairs.map((chair) => chair.userId));
  return {
    panel,
    chairs: chairs.map((chair) => chair.user.displayName),
    candidates: candidates
      .filter((user) => !currentIds.has(user.id))
      .map((user) => ({ id: user.id, label: `${user.displayName} — ${user.emails[0]?.email ?? user.email ?? "no email"}` })),
  };
}
