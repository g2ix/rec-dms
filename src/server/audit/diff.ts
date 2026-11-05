import type { Prisma } from "@prisma/client";
import { canonicalJson } from "./hash";

export const AUDIT_REDACTED = "[redacted]";

const FILE_BODY_KEYS = new Set(["bytes", "buffer", "contentbase64", "filebytes", "filecontent"]);

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

export function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  if (normalized === "code") return false;
  if (normalized === "codehash" || FILE_BODY_KEYS.has(normalized)) return true;
  return (
    normalized.includes("password") ||
    normalized.includes("token") ||
    normalized.includes("secret") ||
    normalized === "authorization"
  );
}

function isSecretCode(key: string, value: unknown): boolean {
  return normalizedKey(key) === "code" && typeof value === "string" && /^\d{4,8}$/.test(value);
}

type JsonMap = { [key: string]: Prisma.InputJsonValue | null };

function jsonLeaf(value: unknown): Prisma.InputJsonValue | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function redactRecord(value: Record<string, unknown>): JsonMap {
  const redacted: JsonMap = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = redactValue(key, entry);
  }
  return redacted;
}

export function redactValue(key: string, value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (isSecretKey(key) || isSecretCode(key, value)) return AUDIT_REDACTED;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? redactRecord(entry as Record<string, unknown>)
        : jsonLeaf(entry),
    );
  }
  if (typeof value === "object") return redactRecord(value as Record<string, unknown>);
  return jsonLeaf(value);
}

export function diffOf(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Prisma.InputJsonObject {
  const left = before ?? {};
  const right = after ?? {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const diff: JsonMap = {};
  for (const key of [...keys].sort()) {
    if (canonicalJson(left[key]) === canonicalJson(right[key])) continue;
    diff[key] = {
      before: redactValue(key, left[key]),
      after: redactValue(key, right[key]),
    };
  }
  return diff;
}
