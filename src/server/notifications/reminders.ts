import "server-only";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export function remindedMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

/** Marks one reminder key on an open task. Returns false when it was already sent or the task closed. */
export async function claimReminder(tx: Tx, taskId: string, key: string, now: Date): Promise<boolean> {
  const rows = await tx.$queryRaw<{ reminded_at: unknown; status: string }[]>`
    SELECT reminded_at, status FROM tasks WHERE id = ${taskId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row || (row.status !== "OPEN" && row.status !== "CLAIMED")) return false;
  const reminded = remindedMap(row.reminded_at);
  if (reminded[key]) return false;
  reminded[key] = now.toISOString();
  await tx.task.update({ where: { id: taskId }, data: { remindedAt: reminded } });
  return true;
}

/** Claims escalation once. A repeated scan finds escalatedAt already set. */
export async function claimEscalation(tx: Tx, taskId: string, now: Date): Promise<boolean> {
  const updated = await tx.task.updateMany({
    where: { id: taskId, escalatedAt: null, status: { in: ["OPEN", "CLAIMED"] } },
    data: { escalatedAt: now },
  });
  return updated.count === 1;
}
