import "server-only";
import type { Prisma } from "@prisma/client";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";
import { audit } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { transactionalMail, type TransactionalMail } from "@/server/mail";
import { deliverEmailJob, deliverNotifyJob, recordNotice } from "@/server/notifications/deliver";
import { claimReminder } from "@/server/notifications/reminders";
import { generateDecisionDocuments } from "@/server/docs/generate";
import { generateStatement } from "@/server/fees/statement";
import { renderFormDocument } from "@/server/docs/render";
import { processFileScan } from "@/server/scan/job";
import { nextAuditAt, nextDigestAt } from "@/server/jobs/schedule";
import { paragraphsOf } from "@/lib/notifications/render";
import { renderNoticeHtml } from "@/server/mail";

type Tx = Prisma.TransactionClient;

const HANDLED = ["NOTIFY", "SEND_EMAIL", "DIGEST", "AUDIT_VERIFY"] as const;

type LockedJob = {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
};

/** 1, 2, 4, 8, then 16 minutes. The fifth failure is terminal. */
export function backoffMs(attempts: number): number {
  return 2 ** Math.max(0, attempts - 1) * 60 * 1000;
}

export async function ensureRecurringJobs(now = new Date()): Promise<void> {
  await ensureKind("DIGEST", nextDigestAt(now));
  await ensureKind("AUDIT_VERIFY", nextAuditAt(now));
}

async function ensureKind(kind: string, runAt: Date): Promise<void> {
  const open = await prisma.job.findFirst({ where: { kind, doneAt: null }, select: { id: true } });
  if (open) return;
  await prisma.job.create({ data: { kind, payload: {}, runAt } });
}

export async function processDueJobs(options?: {
  now?: Date;
  limit?: number;
  mail?: TransactionalMail;
}): Promise<{ processed: number; failed: number }> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? 25;
  const mail = options?.mail ?? transactionalMail();
  await ensureRecurringJobs(now);
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const outcome = await prisma.$transaction(async (tx) => {
      await useAppSchema(tx);
      const rows = await tx.$queryRaw<LockedJob[]>`
        SELECT id, kind, payload, attempts
        FROM jobs
        WHERE done_at IS NULL
          AND run_at <= ${now}
          AND kind IN ('NOTIFY', 'SEND_EMAIL', 'DIGEST', 'AUDIT_VERIFY', 'GENERATE_DOCUMENTS', 'GENERATE_STATEMENT', 'SCAN_FILE', 'CONVERT_PDF')
        ORDER BY run_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const job = rows[0];
      if (!job) return "empty" as const;
      if (job.kind === "GENERATE_DOCUMENTS" || job.kind === "GENERATE_STATEMENT" || job.kind === "SCAN_FILE" || job.kind === "CONVERT_PDF") {
        const attempts = job.attempts + 1;
        await tx.job.update({
          where: { id: job.id },
          data: { attempts, runAt: new Date(now.getTime() + 2 * 60_000) },
        });
        return { kind: job.kind, id: job.id, payload: job.payload, attempts };
      }
      try {
        await dispatch(tx, job, now, mail);
        await tx.job.update({
          where: { id: job.id },
          data: { doneAt: now, attempts: job.attempts + 1, lastError: null },
        });
        return "ok" as const;
      } catch (error) {
        const attempts = job.attempts + 1;
        const terminal = attempts >= 5;
        const message = error instanceof Error ? error.message : "The job failed.";
        await tx.job.update({
          where: { id: job.id },
          data: {
            attempts,
            lastError: message.slice(0, 2000),
            doneAt: terminal ? now : null,
            runAt: terminal ? undefined : new Date(now.getTime() + backoffMs(attempts)),
          },
        });
        if (terminal) await markFailed(tx, job);
        return "failed" as const;
      }
    });
    if (outcome === "empty") break;
    if (typeof outcome === "object") {
      try {
        const finished = await runExternal(outcome.kind, outcome.payload);
        if (finished) {
          await prisma.job.update({
            where: { id: outcome.id },
            data: { doneAt: new Date(), lastError: null },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "The job failed.";
        const terminal = outcome.attempts >= 5 && outcome.kind !== "SCAN_FILE";
        await prisma.job.update({
          where: { id: outcome.id },
          data: {
            lastError: message.slice(0, 2000),
            doneAt: terminal ? new Date() : null,
            runAt: new Date(Date.now() + backoffMs(outcome.attempts)),
          },
        });
        failed += 1;
      }
      processed += 1;
      continue;
    }
    processed += 1;
    if (outcome === "failed") failed += 1;
  }
  return { processed, failed };
}

async function runExternal(kind: string, payload: unknown): Promise<boolean> {
  if (kind === "GENERATE_DOCUMENTS") {
    await generateDecisionDocuments(payload);
    return true;
  }
  const record = asRecord(payload);
  if (kind === "GENERATE_STATEMENT") {
    const billId = stringOf(record.billId);
    if (billId) await generateStatement(billId);
    return true;
  }
  if (kind === "CONVERT_PDF") {
    const instanceId = stringOf(record.instanceId);
    const userId = stringOf(record.userId);
    if (!instanceId || !userId) return true;
    await renderFormDocument({ instanceId, format: "pdf", userId });
    return true;
  }
  const fileId = stringOf(record.fileId);
  if (!fileId) return true;
  const result = await processFileScan(fileId, stringOf(record.startedAt) ?? new Date(0).toISOString());
  return result !== "retry";
}

async function dispatch(tx: Tx, job: LockedJob, now: Date, mail: TransactionalMail): Promise<void> {
  if (!HANDLED.includes(job.kind as (typeof HANDLED)[number])) return;
  if (job.kind === "NOTIFY") {
    const payload = asRecord(job.payload);
    const taskId = stringOf(payload.taskId);
    const reminderKey = stringOf(payload.reminderKey);
    if (taskId && reminderKey) {
      const claimed = await claimReminder(tx, taskId, reminderKey, now);
      if (!claimed) return;
    }
    await deliverNotifyJob(tx, job, mail);
    return;
  }
  if (job.kind === "SEND_EMAIL") {
    await deliverEmailJob(tx, job.payload, mail);
    return;
  }
  if (job.kind === "DIGEST") {
    await sendDigests(tx, mail);
    await tx.job.create({ data: { kind: "DIGEST", payload: {}, runAt: nextDigestAt(new Date(now.getTime() + 60_000)) } });
    return;
  }
  const result = await audit.verifyChain();
  if (!result.ok) {
    const userIds = await systemAdminIds(tx);
    await recordNotice(tx, {
      userIds,
      templateKey: "audit.chain_broken",
      link: "/admin/audit",
      variables: { reason: `#${result.seq.toString()}` },
      jobId: job.id,
      sendNow: true,
      mail,
    });
  }
  await tx.job.create({ data: { kind: "AUDIT_VERIFY", payload: {}, runAt: nextAuditAt(new Date(now.getTime() + 60_000)) } });
}

export async function runDigestBatch(): Promise<{ recipients: number }> {
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const recipients = await sendDigests(tx, transactionalMail());
    return { recipients };
  });
}

export async function runAuditBatch(): Promise<{ ok: boolean; seq: string }> {
  const result = await audit.verifyChain();
  if (!result.ok) {
    await prisma.$transaction(async (tx) => {
      await useAppSchema(tx);
      const userIds = await systemAdminIds(tx);
      await recordNotice(tx, {
        userIds,
        templateKey: "audit.chain_broken",
        link: "/admin/audit",
        variables: { reason: `#${result.seq.toString()}` },
        sendNow: true,
      });
    });
  }
  const seq = result.ok ? (result.seq === null ? "0" : result.seq.toString()) : result.seq.toString();
  return { ok: result.ok, seq };
}

async function sendDigests(tx: Tx, mail: TransactionalMail): Promise<number> {
  const notices = await tx.notification.findMany({
    where: { emailStatus: "DIGEST" },
    orderBy: { createdAt: "asc" },
  });
  const byUser = new Map<string, typeof notices>();
  for (const notice of notices) {
    const list = byUser.get(notice.userId) ?? [];
    list.push(notice);
    byUser.set(notice.userId, list);
  }
  for (const [userId, list] of byUser) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true, displayName: true, emails: { where: { isContact: true }, take: 1, select: { email: true } } },
    });
    const to = user?.emails[0]?.email ?? user?.email;
    if (!to) {
      await tx.notification.updateMany({
        where: { id: { in: list.map((notice) => notice.id) } },
        data: { emailStatus: "FAILED" },
      });
      continue;
    }
    const lines = list.map((notice) => `${notice.title}\n${notice.body}`).join("\n\n");
    const text = `Hello ${user?.displayName ?? ""},\n\nHere is what happened since the last digest.\n\n${lines}`;
    const html = await renderNoticeHtml({
      heading: "Your REC-DMS digest",
      text: paragraphsOf(text).join("\n\n"),
      actionHref: null,
    });
    await mail.send({ to, subject: "Your REC-DMS digest", text, html });
    await tx.notification.updateMany({
      where: { id: { in: list.map((notice) => notice.id) } },
      data: { emailStatus: "SENT", emailedAt: new Date() },
    });
  }
  return byUser.size;
}

async function markFailed(tx: Tx, job: LockedJob): Promise<void> {
  if (job.kind === "SEND_EMAIL") {
    const notificationId = stringOf(asRecord(job.payload).notificationId);
    if (!notificationId) return;
    await tx.notification.updateMany({
      where: { id: notificationId, emailStatus: "QUEUED" },
      data: { emailStatus: "FAILED" },
    });
    return;
  }
  await tx.notification.updateMany({
    where: { emailStatus: "QUEUED", payload: { path: ["jobId"], equals: job.id } },
    data: { emailStatus: "FAILED" },
  });
}

async function systemAdminIds(tx: Tx): Promise<string[]> {
  const grants = await tx.userRole.findMany({
    where: { revokedAt: null, role: { key: "SYSTEM_ADMIN" } },
    select: { userId: true },
  });
  const emails = bootstrapAdminEmails();
  const bootstrap = emails.length
    ? await tx.userEmail.findMany({
        where: { email: { in: emails }, verifiedAt: { not: null } },
        select: { userId: true },
      })
    : [];
  return [...new Set([...grants.map((grant) => grant.userId), ...bootstrap.map((row) => row.userId)])];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
