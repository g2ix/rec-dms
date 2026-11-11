import "server-only";
import type { Prisma } from "@prisma/client";
import { assigneeRuleSchema, type AssigneeRule, type BaseAssigneeRule } from "@/lib/workflow/graph";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";

type Tx = Prisma.TransactionClient;
type ProtocolRef = { id: string; panelId: string | null; leaderUserId: string };

export async function roleKeysFor(tx: Tx, userId: string): Promise<Set<string>> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } }, panelId: true },
  });
  const keys = new Set(grants.map((grant) => grant.role.key));
  if (await bootstrapOn(tx, userId)) {
    keys.add("REC_STAFF");
    keys.add("SYSTEM_ADMIN");
  }
  return keys;
}

export async function panelRoleKeys(tx: Tx, userId: string, panelId: string | null): Promise<Set<string>> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } }, panelId: true },
  });
  const keys = new Set<string>();
  for (const grant of grants) {
    if (grant.panelId == null || grant.panelId === panelId) keys.add(grant.role.key);
  }
  if (await bootstrapOn(tx, userId)) keys.add("REC_STAFF");
  return keys;
}

async function bootstrapOn(tx: Tx, userId: string): Promise<boolean> {
  const allowed = new Set(bootstrapAdminEmails());
  if (allowed.size === 0) return false;
  const emails = await tx.userEmail.findMany({ where: { userId, verifiedAt: { not: null } } });
  return emails.some((email) => allowed.has(email.email));
}

export function readRule(value: unknown): AssigneeRule | null {
  const parsed = assigneeRuleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * People a FIRST_AVAILABLE chain skips on this protocol: its proponents and advisers, and anyone
 * who declared a conflict of interest on it.
 */
export async function unavailableOn(tx: Tx, protocolId: string): Promise<Set<string>> {
  const [members, conflicts] = await Promise.all([
    tx.protocolMember.findMany({
      where: { protocolId, status: { not: "REMOVED" }, role: { in: ["PROPONENT", "ADVISER"] }, userId: { not: null } },
      select: { userId: true },
    }),
    tx.conflictDeclaration.findMany({ where: { protocolId }, select: { userId: true } }),
  ]);
  const out = new Set<string>();
  for (const row of members) if (row.userId) out.add(row.userId);
  for (const row of conflicts) out.add(row.userId);
  return out;
}

/** People a single rule offers, before anyone is skipped. Null means "anyone holding the role" could not be listed. */
async function candidatesOf(
  tx: Tx,
  rule: BaseAssigneeRule,
  protocol: ProtocolRef,
  assignments: Record<string, string[]>,
): Promise<string[]> {
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") return holdersOf(tx, rule, protocol.panelId);
  const slots = await resolveBase(tx, rule, protocol, assignments);
  return slots.map((slot) => slot.userId).filter((id): id is string => Boolean(id));
}

/**
 * Walks a FIRST_AVAILABLE chain. Returns the level that has someone available and who is
 * available there. A level with exactly one person assigns that person.
 */
export async function firstAvailable(
  tx: Tx,
  rule: Extract<AssigneeRule, { kind: "FIRST_AVAILABLE" }>,
  protocol: ProtocolRef,
  assignments: Record<string, string[]>,
  extraSkip: ReadonlySet<string> = new Set(),
): Promise<{ level: number; userIds: string[] } | null> {
  const skip = await unavailableOn(tx, protocol.id);
  for (const id of extraSkip) skip.add(id);
  for (let level = 0; level < rule.rules.length; level += 1) {
    const item = rule.rules[level]!;
    const people = (await candidatesOf(tx, item, protocol, assignments)).filter((id) => !skip.has(id));
    if (people.length > 0) return { level, userIds: [...new Set(people)] };
  }
  return null;
}

export async function userMatchesRule(
  tx: Tx,
  rule: AssigneeRule,
  userId: string,
  protocol: ProtocolRef,
  assignments: Record<string, string[]>,
): Promise<boolean> {
  if (rule.kind === "FIRST_AVAILABLE") {
    const found = await firstAvailable(tx, rule, protocol, assignments);
    return Boolean(found?.userIds.includes(userId));
  }
  if (rule.kind === "USER") return rule.userId === userId;
  if (rule.kind === "PROTOCOL_LEADER") return protocol.leaderUserId === userId;
  if (rule.kind === "PROTOCOL_PROPONENTS" || rule.kind === "PROTOCOL_ADVISER") {
    const role = rule.kind === "PROTOCOL_ADVISER" ? "ADVISER" : "PROPONENT";
    const member = await tx.protocolMember.findFirst({
      where: { protocolId: protocol.id, userId, status: "ACTIVE", role },
      select: { id: true },
    });
    return Boolean(member);
  }
  if (rule.kind === "ASSIGNED_IN_STEP") return (assignments[rule.stepKey] ?? []).includes(userId);
  if (rule.kind === "ROLE") return (await roleKeysFor(tx, userId)).has(rule.role);
  return (await panelRoleKeys(tx, userId, protocol.panelId)).has(rule.role);
}

export type AssigneeSlot = { userId: string | null; rule: AssigneeRule; slot?: string | null };

/** True when a task with no assignee may still be opened for this rule, to be claimed by a role holder. */
export function claimable(rule: AssigneeRule): boolean {
  return rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL" || rule.kind === "FIRST_AVAILABLE";
}

export async function resolveSlots(
  tx: Tx,
  rule: AssigneeRule,
  protocol: ProtocolRef,
  assignments: Record<string, string[]>,
  slotsByStep: Record<string, SlotAssignment[]> = {},
): Promise<AssigneeSlot[]> {
  if (rule.kind === "FIRST_AVAILABLE") {
    const found = await firstAvailable(tx, rule, protocol, assignments);
    if (!found) return [{ userId: null, rule }];
    if (found.userIds.length === 1) return [{ userId: found.userIds[0] ?? null, rule }];
    return [{ userId: null, rule }];
  }
  if (rule.kind === "ASSIGNED_IN_STEP") {
    const slotted = slotsByStep[rule.stepKey];
    if (slotted && slotted.length > 0) return slotted.map((item) => ({ userId: item.userId, rule, slot: item.slot }));
  }
  return resolveBase(tx, rule, protocol, assignments);
}

async function resolveBase(
  tx: Tx,
  rule: BaseAssigneeRule,
  protocol: ProtocolRef,
  assignments: Record<string, string[]>,
): Promise<AssigneeSlot[]> {
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    const holders = await holdersOf(tx, rule, protocol.panelId);
    if (holders.length === 1) return [{ userId: holders[0] ?? null, rule }];
    return [{ userId: null, rule }];
  }
  if (rule.kind === "USER") return [{ userId: rule.userId, rule }];
  if (rule.kind === "PROTOCOL_LEADER") return [{ userId: protocol.leaderUserId, rule }];
  if (rule.kind === "PROTOCOL_ADVISER") {
    const adviser = await tx.protocolMember.findFirst({
      where: { protocolId: protocol.id, role: "ADVISER", status: "ACTIVE", userId: { not: null } },
      select: { userId: true },
    });
    return [{ userId: adviser?.userId ?? null, rule }];
  }
  if (rule.kind === "PROTOCOL_PROPONENTS") {
    const members = await tx.protocolMember.findMany({
      where: { protocolId: protocol.id, role: "PROPONENT", status: "ACTIVE", userId: { not: null } },
      select: { userId: true },
    });
    if (members.length === 0) return [{ userId: null, rule }];
    return members.map((member) => ({ userId: member.userId, rule }));
  }
  const ids = assignments[rule.stepKey] ?? [];
  if (ids.length === 0) return [{ userId: null, rule }];
  return ids.map((userId) => ({ userId, rule }));
}

export async function holdersOf(
  tx: Tx,
  rule: Extract<BaseAssigneeRule, { kind: "ROLE" | "PANEL_ROLE_OF_PROTOCOL" }>,
  panelId: string | null,
): Promise<string[]> {
  const grants = await tx.userRole.findMany({
    where: {
      revokedAt: null,
      role: { key: rule.role },
      ...(rule.kind === "PANEL_ROLE_OF_PROTOCOL" ? { OR: [{ panelId: null }, { panelId }] } : {}),
    },
    select: { userId: true },
  });
  return [...new Set(grants.map((grant) => grant.userId))];
}

export type SlotAssignment = { userId: string; slot: string | null };

/**
 * Reviewers chosen on each step. Older instances store `string[]`; slot steps store
 * `{ userId, slot }[]`. Both read the same way here.
 */
export function readSlotAssignments(value: unknown): Record<string, SlotAssignment[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, SlotAssignment[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!Array.isArray(item)) continue;
    const rows: SlotAssignment[] = [];
    for (const entry of item) {
      if (typeof entry === "string") rows.push({ userId: entry, slot: null });
      else if (entry && typeof entry === "object" && typeof (entry as { userId?: unknown }).userId === "string") {
        const slot = (entry as { slot?: unknown }).slot;
        rows.push({ userId: (entry as { userId: string }).userId, slot: typeof slot === "string" ? slot : null });
      }
    }
    out[key] = rows;
  }
  return out;
}

/** User ids chosen on each step, whatever shape the instance stored. */
export function readAssignments(value: unknown): Record<string, string[]> {
  const slots = readSlotAssignments(value);
  const out: Record<string, string[]> = {};
  for (const [key, rows] of Object.entries(slots)) out[key] = rows.map((row) => row.userId);
  return out;
}

/** Writes slot rows when any row has a slot, so graphs without slots keep the old `string[]` shape. */
export function writeAssignments(slots: Record<string, SlotAssignment[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, rows] of Object.entries(slots)) {
    out[key] = rows.some((row) => row.slot) ? rows.map((row) => ({ userId: row.userId, slot: row.slot })) : rows.map((row) => row.userId);
  }
  return out;
}

/** The slot a user fills on a step, if the step assigned reviewers by slot. */
export function slotOf(slots: Record<string, SlotAssignment[]>, stepKey: string, userId: string): string | null {
  return slots[stepKey]?.find((row) => row.userId === userId)?.slot ?? null;
}

function attributesOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** True when the user has a grant that satisfies a slot's roles and attributes. */
export async function eligibleForSlot(
  tx: Tx,
  userId: string,
  eligible: { roles?: string[]; attributes?: Record<string, unknown> } | undefined,
): Promise<boolean> {
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null, ...(eligible?.roles?.length ? { role: { key: { in: eligible.roles } } } : {}) },
    select: { attributes: true },
  });
  if (grants.length === 0) return false;
  const wanted = Object.entries(eligible?.attributes ?? {});
  if (wanted.length === 0) return true;
  return grants.some((grant) => {
    const attrs = attributesOf(grant.attributes);
    return wanted.every(([key, value]) => attrs[key] === value);
  });
}
