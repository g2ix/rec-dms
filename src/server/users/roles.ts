import "server-only";
import type { Prisma, UserStatus } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { profileGaps } from "@/lib/profile";
import {
  AUTHORITY_LABEL,
  canGrantAs,
  GROUP_ORDER,
  isAccountRole,
  ROLE_INFO,
  type AccountRoleKey,
  type GrantAuthority,
  type GrantorFacts,
  type RoleGroup,
} from "@/lib/users/role-authority";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { actsAsSystemAdmin, canManageUsers, type UserAdminFacts } from "@/server/authz/policy";
import { ACTIVE_SYSTEM_ADMIN, userAdminFacts } from "@/server/authz/user-admin";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { recordNotice } from "@/server/notifications/deliver";
import { getPersonProfile } from "@/server/profiles/profile";

type Tx = Prisma.TransactionClient;
type AuditMeta = Awaited<ReturnType<typeof auditRequestMeta>>;

const SYSTEM_ADMIN = "SYSTEM_ADMIN";
const PANEL_CHAIR = "PANEL_CHAIR";
/** Per-panel roles with one holder each. With two holders the engine leaves the task unassigned. */
const SINGLE_HOLDER_PANEL_ROLES = new Set([PANEL_CHAIR, "PANEL_VICE_CHAIR", "PANEL_SECRETARY"]);
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
  if (!canManageUsers(facts)) throw forbidden("Only REC Staff, the REC Chair, or a System Admin can manage users.");
  return facts;
}

export function grantorFacts(facts: UserAdminFacts): GrantorFacts {
  return { roleKeys: facts.roleKeys, actsAsSystemAdmin: actsAsSystemAdmin(facts) };
}

/** Roles outside the known list are committee appointments, so they need the REC Chair. */
function authorityOf(roleKey: string): GrantAuthority {
  return ROLE_INFO[roleKey]?.authority ?? "chair";
}

function assertMayGrant(facts: UserAdminFacts, role: { key: string; name: string }) {
  const authority = authorityOf(role.key);
  if (!canGrantAs(grantorFacts(facts), authority)) {
    throw forbidden(`Only ${AUTHORITY_LABEL[authority]} can grant or revoke ${role.name}.`);
  }
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

/**
 * One grant inside a role transaction. A single-holder panel role held by someone else is handed over
 * only when a reason is given, and the hand-over is audited as a revoke and a grant.
 */
async function grantInTx(
  tx: Tx,
  facts: UserAdminFacts,
  input: { actorUserId: string; userId: string; roleId: string; panelId: string | null; replaceReason: string; meta: AuditMeta },
) {
  const role = await tx.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw invalid("Choose a role.");
  const account = isAccountRole(role.key);
  if (role.scope === "PROTOCOL" && !account) throw invalid("This role is held through a protocol, not granted here.");
  assertMayGrant(facts, role);
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
  if (existing) throw invalid(`This person already holds ${role.name}.`);

  if (panel && SINGLE_HOLDER_PANEL_ROLES.has(role.key)) {
    const holders = await tx.userRole.findMany({
      where: { panelId: panel.id, revokedAt: null, roleId: role.id, userId: { not: input.userId } },
      include: { user: { select: { displayName: true } } },
    });
    if (holders.length > 0 && !input.replaceReason) {
      throw invalid(`${holders[0]!.user.displayName} is the ${role.name} of this panel. Enter a reason to hand the role over.`);
    }
    for (const holder of holders) {
      await endGrant(tx, { actorUserId: input.actorUserId, grant: holder, roleKey: role.key, reason: input.replaceReason, meta: input.meta });
    }
  }

  return addGrant(tx, { actorUserId: input.actorUserId, userId: input.userId, role, panel, meta: input.meta });
}

async function revokeInTx(tx: Tx, facts: UserAdminFacts, input: { actorUserId: string; userRoleId: string; reason: string; meta: AuditMeta }) {
  const grant = await tx.userRole.findUnique({ where: { id: input.userRoleId }, include: { role: { select: { key: true, name: true } } } });
  if (!grant || grant.revokedAt) throw new AppError("NOT_FOUND", "That role is no longer active.", 404);
  assertMayGrant(facts, grant.role);

  if (grant.role.key === SYSTEM_ADMIN) {
    const other = await tx.userRole.findFirst({
      where: { ...ACTIVE_SYSTEM_ADMIN, userId: { not: grant.userId } },
      select: { id: true },
    });
    if (!other) throw invalid("This is the last System Admin. Grant the role to someone else first.");
  }

  await endGrant(tx, { actorUserId: input.actorUserId, grant, roleKey: grant.role.key, reason: input.reason, meta: input.meta });
  return grant;
}

export async function grantRole(input: { actorUserId: string; userId: string; roleId: string; panelId: string | null }) {
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    return grantInTx(tx, facts, { ...input, replaceReason: "", meta });
  });
}

export async function revokeRole(input: { actorUserId: string; userRoleId: string; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw invalid("Enter the reason for revoking this role.");
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    const grant = await revokeInTx(tx, facts, { actorUserId: input.actorUserId, userRoleId: input.userRoleId, reason, meta });
    return { userId: grant.userId };
  });
}

/**
 * Saves every role change made on the person page at once. Revokes and hand-overs need the reason;
 * a new grant on its own does not. Nothing is saved if any change is refused.
 */
export async function applyRoleChanges(input: {
  actorUserId: string;
  userId: string;
  add: { roleId: string; panelId: string | null }[];
  remove: string[];
  reason: string;
}) {
  const reason = input.reason.trim();
  if (input.add.length === 0 && input.remove.length === 0) throw invalid("Choose a role to grant or revoke first.");
  if (input.remove.length > 0 && !reason) throw invalid("Enter the reason for revoking.");
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    for (const userRoleId of input.remove) {
      const grant = await tx.userRole.findUnique({ where: { id: userRoleId }, select: { userId: true } });
      if (!grant || grant.userId !== input.userId) throw new AppError("NOT_FOUND", "That role is no longer active.", 404);
      await revokeInTx(tx, facts, { actorUserId: input.actorUserId, userRoleId, reason, meta });
    }
    for (const item of input.add) {
      await grantInTx(tx, facts, { actorUserId: input.actorUserId, userId: input.userId, ...item, replaceReason: reason, meta });
    }
    return { granted: input.add.length, revoked: input.remove.length };
  });
}

/** Replaces the panel's chair in one transaction: one revoked event per old chair, one granted event. */
export async function changePanelChair(input: { actorUserId: string; panelId: string; newChairUserId: string; reason: string }) {
  const reason = input.reason.trim();
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    const panel = await activePanel(tx, input.panelId);
    const role = await tx.role.findUnique({ where: { key: PANEL_CHAIR } });
    if (!role) throw invalid("The Panel Chair role is not set up yet.");
    assertMayGrant(facts, role);
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

/**
 * Approves a pending account as a proponent, an adviser, or both. The profile must be complete first,
 * because every form the person files is prefilled from it.
 */
export async function approvePendingUser(input: { actorUserId: string; userId: string; accountRoles: AccountRoleKey[] }) {
  const accountRoles = [...new Set(input.accountRoles)].filter(isAccountRole);
  if (accountRoles.length === 0) throw invalid("Choose what this account is for: proponent, adviser, or both.");
  const gaps = profileGaps(await getPersonProfile(input.userId));
  if (gaps.length > 0) throw invalid("This person's profile is not complete yet. Ask them to finish it before approving.");
  const meta = await auditRequestMeta();
  return roleTransaction(async (tx) => {
    const facts = await assertManager(tx, input.actorUserId);
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user) throw new AppError("NOT_FOUND", "That account was not found.", 404);
    if (user.status !== "PENDING_APPROVAL") throw invalid("This account is no longer waiting for approval.");

    await tx.user.update({ where: { id: input.userId }, data: { status: "ACTIVE", approvedById: input.actorUserId, approvedAt: new Date() } });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.userApproved,
      entityType: "user",
      entityId: input.userId,
      diff: diffOf({ status: user.status }, { status: "ACTIVE", accountRoles }),
      meta,
    });
    const roles = await tx.role.findMany({ where: { key: { in: accountRoles } } });
    for (const role of roles) {
      await grantInTx(tx, facts, { actorUserId: input.actorUserId, userId: input.userId, roleId: role.id, panelId: null, replaceReason: "", meta });
    }
    await recordNotice(tx, { userIds: [input.userId], templateKey: "account.approved", link: "/app" });
  });
}

/** Tells a pending person what their profile still needs. Sent in-app and by email. */
export async function askToCompleteProfile(input: { actorUserId: string; userId: string }) {
  return prisma.$transaction(async (tx) => {
    await assertManager(tx, input.actorUserId);
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { status: true } });
    if (!user || user.status !== "PENDING_APPROVAL") throw invalid("This account is no longer waiting for approval.");
    await recordNotice(tx, { userIds: [input.userId], templateKey: "account.profile_needed", link: "/app/account/profile" });
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

function searchWhere(q: string): Prisma.UserWhereInput {
  return q
    ? {
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
        ],
      }
    : {};
}

export async function listUsersWithRoles(q: string, status?: UserStatus) {
  const users = await prisma.user.findMany({
    where: { status: status ?? { not: "MERGED" }, ...searchWhere(q) },
    include: {
      emails: { where: { isContact: true } },
      roles: { where: { revokedAt: null }, include: { role: { select: { key: true, name: true } } } },
    },
    orderBy: { displayName: "asc" },
    take: LIST_LIMIT,
  });
  return users.map((user) => {
    const byKey = new Map(user.roles.map((grant) => [grant.role.key, grant.role.name]));
    return {
      id: user.id,
      displayName: user.displayName,
      status: user.status,
      email: user.emails[0]?.email ?? user.email ?? null,
      roles: [...byKey].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export async function userStatusCounts() {
  const rows = await prisma.user.groupBy({ by: ["status"], _count: { _all: true }, where: { status: { not: "MERGED" } } });
  const count = (status: UserStatus) => rows.find((row) => row.status === status)?._count._all ?? 0;
  return { active: count("ACTIVE"), pending: count("PENDING_APPROVAL"), suspended: count("SUSPENDED") };
}

export type RoleCardPanel = {
  panelId: string;
  panelName: string;
  grantId: string | null;
  /** Someone else who holds this single-holder role on the panel. */
  heldBy: string | null;
};

export type RoleCard = {
  roleId: string;
  key: string;
  name: string;
  blurb: string;
  group: RoleGroup;
  canChange: boolean;
  lockedNote: string | null;
  singleHolder: boolean;
  /** Global and account roles. */
  grantId: string | null;
  granted: { at: Date; by: string | null } | null;
  /** Panel roles, one entry per active panel. */
  panels: RoleCardPanel[] | null;
};

export async function userRoleDetail(actorUserId: string, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      emails: { where: { isContact: true } },
      roles: { where: { revokedAt: null }, include: { role: true }, orderBy: { grantedAt: "asc" } },
    },
  });
  if (!user || user.status === "MERGED") return null;

  const [facts, roles, panels, panelHolders, profile] = await Promise.all([
    userAdminFacts(actorUserId),
    prisma.role.findMany({ where: { key: { in: Object.keys(ROLE_INFO) } } }),
    prisma.panel.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.userRole.findMany({
      where: { revokedAt: null, panelId: { not: null }, userId: { not: userId }, role: { key: { in: [...SINGLE_HOLDER_PANEL_ROLES] } } },
      include: { user: { select: { displayName: true } }, role: { select: { key: true } } },
    }),
    getPersonProfile(userId),
  ]);
  const grantor = grantorFacts(facts);
  const granterIds = user.roles.flatMap((grant) => (grant.grantedById ? [grant.grantedById] : []));
  const granters = await prisma.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, displayName: true } });
  const granterName = new Map(granters.map((granter) => [granter.id, granter.displayName]));
  const note = (grant: { grantedAt: Date; grantedById: string | null }) => ({
    at: grant.grantedAt,
    by: grant.grantedById ? (granterName.get(grant.grantedById) ?? null) : null,
  });

  const cards: RoleCard[] = roles
    .map((role) => {
      const info = ROLE_INFO[role.key]!;
      const canChange = canGrantAs(grantor, info.authority);
      const mine = user.roles.filter((grant) => grant.roleId === role.id);
      const isPanel = role.scope === "PANEL";
      const global = isPanel ? undefined : mine.find((grant) => grant.panelId === null);
      return {
        roleId: role.id,
        key: role.key,
        name: role.name,
        blurb: info.blurb,
        group: info.group,
        canChange,
        lockedNote: canChange ? null : `Only ${AUTHORITY_LABEL[info.authority]} can change this.`,
        singleHolder: SINGLE_HOLDER_PANEL_ROLES.has(role.key),
        grantId: global?.id ?? null,
        granted: global ? note(global) : null,
        panels: isPanel
          ? panels.map((panel) => ({
              panelId: panel.id,
              panelName: panel.name,
              grantId: mine.find((grant) => grant.panelId === panel.id)?.id ?? null,
              heldBy: panelHolders.find((holder) => holder.panelId === panel.id && holder.role.key === role.key)?.user.displayName ?? null,
            }))
          : null,
      };
    })
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || Object.keys(ROLE_INFO).indexOf(a.key) - Object.keys(ROLE_INFO).indexOf(b.key));

  return {
    id: user.id,
    displayName: user.displayName,
    status: user.status,
    email: user.emails[0]?.email ?? user.email ?? null,
    createdAt: user.createdAt,
    approvedAt: user.approvedAt,
    profile,
    profileGaps: profileGaps(profile),
    cards,
    /** Grants for roles that have no card, such as one set up outside the known list. */
    otherGrants: user.roles
      .filter((grant) => !(grant.role.key in ROLE_INFO))
      .map((grant) => ({ id: grant.id, roleName: grant.role.name })),
  };
}

export async function pendingUsers() {
  const users = await prisma.user.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: { emails: true },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    users.map(async (user) => {
      const profile = await getPersonProfile(user.id);
      return {
        id: user.id,
        displayName: user.displayName,
        emails: user.emails.map((email) => ({ email: email.email, verified: Boolean(email.verifiedAt) })),
        createdAt: user.createdAt,
        profile,
        gaps: profileGaps(profile),
      };
    }),
  );
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
      where: { status: "ACTIVE", ...searchWhere(q) },
      include: {
        emails: { where: { isContact: true } },
        roles: { where: { revokedAt: null, OR: [{ panelId }, { panelId: null }] }, include: { role: { select: { key: true, name: true } } } },
      },
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
      .map((user) => ({
        id: user.id,
        name: user.displayName,
        email: user.emails[0]?.email ?? user.email ?? null,
        roles: [...new Set(user.roles.filter((grant) => !isAccountRole(grant.role.key)).map((grant) => grant.role.name))],
        onPanel: user.roles.some((grant) => grant.panelId === panelId),
      }))
      .sort((a, b) => Number(b.onPanel) - Number(a.onPanel) || a.name.localeCompare(b.name)),
  };
}
