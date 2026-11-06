import "server-only";
import type { Notification, Prisma } from "@prisma/client";
import { prefersDigest, fallbackTemplate, type NoticeChannel, type NoticeTemplate } from "@/lib/notifications/catalog";
import { applyVariables, firstLink, markdownToText } from "@/lib/notifications/render";
import { formatManila } from "@/lib/time";
import { env } from "@/lib/env";
import { toJson } from "@/server/forms/json";
import { renderNoticeHtml, transactionalMail, type TransactionalMail } from "@/server/mail";
import { useAppSchema as pinAppSchema } from "@/server/db";

type Tx = Prisma.TransactionClient;

export type NoticeInput = {
  userIds: string[];
  templateKey: string;
  protocolId?: string | null;
  taskId?: string | null;
  link?: string | null;
  variables?: Record<string, string | null | undefined>;
  /** When set, a retry of the same job does not create a second notice. */
  jobId?: string | null;
  /** False keeps the row in-app and queues email on a SEND_EMAIL job. */
  sendNow?: boolean;
  /** False writes the in-app row and does not email. */
  email?: boolean;
  mail?: TransactionalMail;
};

function absolute(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, env.AUTH_URL).toString();
}

async function resolveTemplate(tx: Tx, key: string): Promise<NoticeTemplate> {
  const row = await tx.notificationTemplate.findUnique({ where: { key } });
  if (!row) return fallbackTemplate(key);
  const channels = row.channels.filter((item): item is NoticeChannel => item === "IN_APP" || item === "EMAIL");
  return {
    key: row.key,
    subject: row.subject,
    bodyMarkdown: row.bodyMarkdown,
    channels: channels.length > 0 ? channels : ["IN_APP"],
    description: row.description,
    variables: Array.isArray(row.variables) ? row.variables.filter((item): item is string => typeof item === "string") : [],
  };
}

async function baseVariables(tx: Tx, input: NoticeInput): Promise<Record<string, string>> {
  const protocol = input.protocolId
    ? await tx.protocol.findUnique({ where: { id: input.protocolId }, select: { code: true, title: true } })
    : null;
  const task = input.taskId
    ? await tx.task.findUnique({ where: { id: input.taskId }, select: { title: true, dueAt: true } })
    : null;
  const linkPath = input.link ?? (input.taskId ? "/app/tasks" : input.protocolId ? `/app/protocols/${input.protocolId}` : "/app");
  const variables: Record<string, string> = {
    protocolCode: protocol?.code || "Not yet assigned",
    protocolTitle: protocol?.title ?? "",
    taskName: task?.title ?? "",
    stepName: task?.title ?? "",
    dueAt: task?.dueAt ? formatManila(task.dueAt, "d MMM yyyy, h:mm a") : "",
    link: absolute(linkPath),
    recipientName: "",
    reason: "",
    decision: "",
    roleLabel: "",
    daysLeft: "",
  };
  for (const [key, value] of Object.entries(input.variables ?? {})) {
    if (value != null) variables[key] = value;
  }
  if (input.link) variables.link = absolute(input.link);
  return variables;
}

async function person(tx: Tx, userId: string): Promise<{ email: string | null; name: string }> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      email: true,
      emails: { where: { isContact: true }, take: 1, select: { email: true } },
    },
  });
  return { email: user?.emails[0]?.email ?? user?.email ?? null, name: user?.displayName ?? "" };
}

export async function recordNotice(tx: Tx, input: NoticeInput): Promise<Notification[]> {
  await pinAppSchema(tx);
  const template = await resolveTemplate(tx, input.templateKey);
  const shared = await baseVariables(tx, input);
  const wantsEmail = input.email !== false && template.channels.includes("EMAIL");
  const created: Notification[] = [];
  for (const userId of [...new Set(input.userIds)]) {
    const sourceKey = input.jobId ? `${input.jobId}:${userId}:${template.key}` : null;
    if (sourceKey) {
      const existing = await tx.notification.findFirst({
        where: { userId, type: template.key, payload: { path: ["sourceKey"], equals: sourceKey } },
      });
      if (existing) {
        created.push(existing);
        continue;
      }
    }
    const who = await person(tx, userId);
    const variables: Record<string, string> = { ...shared, recipientName: who.name };
    const subject = applyVariables(template.subject, variables).replace(/\s+/g, " ").trim();
    const text = markdownToText(applyVariables(template.bodyMarkdown, variables));
    const preference = await tx.notificationPreference.findUnique({ where: { userId } });
    const digest = wantsEmail && prefersDigest(template.key, preference?.digest ?? "IMMEDIATE");
    const emailStatus = !wantsEmail ? "NONE" : digest ? "DIGEST" : "QUEUED";
    const notice = await tx.notification.create({
      data: {
        userId,
        type: template.key,
        title: subject,
        body: text,
        link: variables.link,
        protocolId: input.protocolId ?? null,
        taskId: input.taskId ?? null,
        emailStatus,
        payload: toJson({
          sourceKey,
          jobId: input.jobId ?? null,
          variables,
          actionHref: firstLink(applyVariables(template.bodyMarkdown, variables)) ?? variables.link,
        }),
      },
    });
    created.push(notice);
    if (emailStatus === "QUEUED" && !input.sendNow) {
      await tx.job.create({
        data: { kind: "SEND_EMAIL", payload: toJson({ notificationId: notice.id }), runAt: new Date() },
      });
    }
  }
  if (input.sendNow) await sendQueued(tx, created, input.mail ?? transactionalMail());
  return created;
}

export async function sendQueued(tx: Tx, notices: Notification[], mail: TransactionalMail): Promise<void> {
  for (const notice of notices) {
    if (notice.emailStatus !== "QUEUED") continue;
    await sendNotice(tx, notice, mail);
  }
}

export async function sendNotice(tx: Tx, notice: Notification, mail: TransactionalMail = transactionalMail()): Promise<void> {
  const who = await person(tx, notice.userId);
  if (!who.email) {
    await tx.notification.update({ where: { id: notice.id }, data: { emailStatus: "FAILED" } });
    return;
  }
  const payload = notice.payload && typeof notice.payload === "object" && !Array.isArray(notice.payload) ? notice.payload : {};
  const actionHref = typeof payload.actionHref === "string" ? payload.actionHref : notice.link;
  const html = await renderNoticeHtml({ heading: notice.title, text: notice.body, actionHref });
  await mail.send({ to: who.email, subject: notice.title, text: notice.body, html });
  await tx.notification.update({
    where: { id: notice.id },
    data: { emailStatus: "SENT", emailedAt: new Date() },
  });
}

export async function deliverNotifyJob(
  tx: Tx,
  job: { id: string; payload: unknown },
  mail: TransactionalMail,
): Promise<void> {
  const payload = asRecord(job.payload);
  const templateKey = stringOf(payload.templateKey) || "task.assigned";
  let userIds = stringList(payload.userIds);
  const protocolId = stringOf(payload.protocolId);
  const taskId = stringOf(payload.taskId);
  if (userIds.length === 0 && protocolId) {
    const protocol = await tx.protocol.findUnique({ where: { id: protocolId }, select: { leaderUserId: true } });
    if (protocol) userIds = [protocol.leaderUserId];
  }
  if (userIds.length === 0) return;
  await recordNotice(tx, {
    userIds,
    templateKey,
    protocolId,
    taskId,
    jobId: job.id,
    variables: stringRecord(payload.variables),
    sendNow: true,
    mail,
  });
}

export async function deliverEmailJob(tx: Tx, payload: unknown, mail: TransactionalMail): Promise<void> {
  const notificationId = stringOf(asRecord(payload).notificationId);
  if (!notificationId) return;
  const notice = await tx.notification.findUnique({ where: { id: notificationId } });
  if (!notice || notice.emailStatus === "SENT" || notice.emailStatus === "NONE" || notice.emailStatus === "DIGEST") return;
  if (notice.emailStatus === "FAILED") return;
  await sendNotice(tx, notice, mail);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}
