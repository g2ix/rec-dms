import "server-only";
import type { Prisma } from "@prisma/client";
import { assigneeRuleSchema, type AssigneeRule } from "@/lib/workflow/graph";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";

type Tx = Prisma.TransactionClient;

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

export async function userMatchesRule(
  tx: Tx,
  rule: AssigneeRule,
  userId: string,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
): Promise<boolean> {
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

export type AssigneeSlot = { userId: string | null; rule: AssigneeRule };

export async function resolveSlots(
  tx: Tx,
  rule: AssigneeRule,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
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

async function holdersOf(
  tx: Tx,
  rule: Extract<AssigneeRule, { kind: "ROLE" | "PANEL_ROLE_OF_PROTOCOL" }>,
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

export function readAssignments(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) out[key] = item.filter((id): id is string => typeof id === "string");
  }
  return out;
}
