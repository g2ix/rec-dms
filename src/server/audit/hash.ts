import { createHash } from "node:crypto";

export const AUDIT_GENESIS = "GENESIS";

export type AuditBody = {
  action: string;
  actorUserId: string | null;
  actingRole: string | null;
  entityType: string;
  entityId: string;
  protocolId: string | null;
  diff: unknown;
  meta: unknown;
  occurredAt: string;
};

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

export function hashAudit(prevHash: string, body: AuditBody): string {
  return createHash("sha256").update(prevHash + canonicalJson(body)).digest("hex");
}

export function secondPrecision(date: Date): Date {
  const copy = new Date(date);
  copy.setMilliseconds(0);
  return copy;
}
