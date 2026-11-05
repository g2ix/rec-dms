import { formatManila } from "@/lib/time";

export type SaveConflict = {
  ok: false;
  code: "CONFLICT";
  revision: number;
  value: unknown;
  changedBy: { id: string; name: string } | null;
  changedAt: string | null;
};

export function conflictResult(
  expectedRevision: number,
  actualRevision: number,
  value: unknown,
  changedBy: { id: string; name: string } | null,
  changedAt: Date | null,
): SaveConflict | null {
  if (expectedRevision === actualRevision) return null;
  return {
    ok: false,
    code: "CONFLICT",
    revision: actualRevision,
    value: value ?? null,
    changedBy,
    changedAt: changedAt ? changedAt.toISOString() : null,
  };
}

export function formatFieldValue(value: unknown): string {
  if (value == null || value === "") return "empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value && "choice" in value) {
    const choice = (value as { choice?: unknown; reason?: unknown }).choice;
    const reason = (value as { reason?: unknown }).reason;
    const label = choice === "YES" ? "Yes" : choice === "NO" ? "No" : choice === "NA" ? "Not applicable" : String(choice ?? "");
    return typeof reason === "string" && reason.trim() ? `${label} (${reason})` : label;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "a value";
  }
}

export function isConflict(result: { ok: boolean; code?: string }): result is SaveConflict {
  return result.ok === false && result.code === "CONFLICT" && "revision" in result;
}

export function formatConflict(conflict: SaveConflict): string {
  const who = conflict.changedBy?.name ?? "Someone else";
  const when = conflict.changedAt ? formatManila(new Date(conflict.changedAt)) : "a moment ago";
  return `Changed by ${who} at ${when}. Their value: ${formatFieldValue(conflict.value)}.`;
}
