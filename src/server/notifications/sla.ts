import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { manilaDay, subtractDuration } from "@/lib/workflow/calendar";
import { parseGraph, type AssigneeRule, type Step } from "@/lib/workflow/graph";
import { audit } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { recordNotice } from "@/server/notifications/deliver";
import { claimEscalation, claimReminder } from "@/server/notifications/reminders";
import { lapseOverdueWaits } from "@/server/workflow/engine";
import { readAssignments, resolveSlots } from "@/server/workflow/who";

type Tx = Prisma.TransactionClient;

const REVISION_REMINDERS = [5, 1] as const;

export type SlaScan = {
  dueSoon: number;
  overdue: number;
  escalated: number;
  revisionReminders: number;
  lapsed: number;
};

export async function scanSla(now = new Date()): Promise<SlaScan> {
  const holidays = await holidaySet();
  const tasks = await prisma.task.findMany({
    where: {
      kind: "MAIN",
      status: { in: ["OPEN", "CLAIMED"] },
      dueAt: { not: null },
      instance: { status: "RUNNING" },
    },
    select: {
      id: true,
      dueAt: true,
      stepKey: true,
      assigneeUserId: true,
      instance: {
        select: {
          id: true,
          assignments: true,
          protocolId: true,
          version: { select: { graph: true } },
          protocol: { select: { id: true, panelId: true, leaderUserId: true, code: true, title: true } },
        },
      },
    },
  });
  const totals: SlaScan = { dueSoon: 0, overdue: 0, escalated: 0, revisionReminders: 0, lapsed: 0 };
  for (const task of tasks) {
    if (!task.dueAt || !task.stepKey || !task.instance) continue;
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (!step) continue;
    const counts = await prisma.$transaction(async (tx) => {
      await useAppSchema(tx);
      return scanTask(tx, {
        id: task.id,
        dueAt: task.dueAt!,
        assigneeUserId: task.assigneeUserId,
        step,
        protocol: task.instance!.protocol,
        assignments: readAssignments(task.instance!.assignments),
        holidays,
        now,
      });
    });
    totals.dueSoon += counts.dueSoon;
    totals.overdue += counts.overdue;
    totals.escalated += counts.escalated;
    totals.revisionReminders += counts.revisionReminders;
    totals.lapsed += counts.lapsed;
  }
  await lapseOverdueWaits(now);
  return totals;
}

async function scanTask(
  tx: Tx,
  input: {
    id: string;
    dueAt: Date;
    assigneeUserId: string | null;
    step: Step;
    protocol: { id: string; panelId: string | null; leaderUserId: string; code: string | null; title: string };
    assignments: Record<string, string[]>;
    holidays: Set<string>;
    now: Date;
  },
): Promise<SlaScan> {
  const counts: SlaScan = { dueSoon: 0, overdue: 0, escalated: 0, revisionReminders: 0, lapsed: 0 };
  const due = input.dueAt.getTime();
  const assignees = input.assigneeUserId ? [input.assigneeUserId] : await roleHolders(tx, input.step.assignee, input.protocol);
  for (const offset of input.step.deadline?.remindBefore ?? []) {
    const at = subtractDuration(input.dueAt, offset.amount, offset.unit, input.holidays);
    if (input.now.getTime() < at.getTime()) continue;
    const key = `due_soon:${offset.amount}:${offset.unit}`;
    if (!(await claimReminder(tx, input.id, key, input.now))) continue;
    await recordNotice(tx, {
      userIds: assignees,
      templateKey: input.step.notify?.onDueSoon ?? "task.due_soon",
      protocolId: input.protocol.id,
      taskId: input.id,
      link: "/app/tasks",
    });
    counts.dueSoon += 1;
  }
  if (input.step.type === "WAIT_PROPONENT") {
    for (const days of REVISION_REMINDERS) {
      const at = subtractDuration(input.dueAt, days, "WORKING_DAYS", input.holidays);
      if (input.now.getTime() < at.getTime()) continue;
      const key = `revision:${days}`;
      if (!(await claimReminder(tx, input.id, key, input.now))) continue;
      await recordNotice(tx, {
        userIds: assignees,
        templateKey: "protocol.revision_due_soon",
        protocolId: input.protocol.id,
        taskId: input.id,
        link: `/app/protocols/${input.protocol.id}`,
        variables: { daysLeft: String(days) },
      });
      counts.revisionReminders += 1;
    }
  }
  if (input.now.getTime() >= due) {
    const overdueKey = "overdue";
    if (input.step.type !== "WAIT_PROPONENT" && (await claimReminder(tx, input.id, overdueKey, input.now))) {
      await recordNotice(tx, {
        userIds: assignees,
        templateKey: input.step.notify?.onOverdue ?? "task.overdue",
        protocolId: input.protocol.id,
        taskId: input.id,
        link: "/app/tasks",
      });
      counts.overdue += 1;
    }
    if (input.step.deadline?.escalateTo) {
      const targets = await recipientIds(tx, input.step.deadline.escalateTo, input.protocol, input.assignments);
      if (targets.length > 0 && (await claimEscalation(tx, input.id, input.now))) {
        await recordNotice(tx, {
          userIds: targets,
          templateKey: "task.escalated",
          protocolId: input.protocol.id,
          taskId: input.id,
          link: `/app/protocols/${input.protocol.id}`,
        });
        await audit.record(tx, {
          actorUserId: null,
          action: AuditAction.taskEscalated,
          entityType: "task",
          entityId: input.id,
          protocolId: input.protocol.id,
          diff: { escalatedTo: targets, rule: toJson(input.step.deadline.escalateTo) },
          meta: {},
        });
        counts.escalated += 1;
      }
    }
    if (input.step.type === "WAIT_PROPONENT" && (await claimReminder(tx, input.id, "lapsed", input.now))) {
      await recordNotice(tx, {
        userIds: assignees.length > 0 ? assignees : [input.protocol.leaderUserId],
        templateKey: "protocol.lapsed",
        protocolId: input.protocol.id,
        taskId: input.id,
        link: `/app/protocols/${input.protocol.id}`,
      });
      counts.lapsed += 1;
    }
  }
  return counts;
}

async function roleHolders(
  tx: Tx,
  rule: AssigneeRule | undefined,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
): Promise<string[]> {
  if (!rule) return [];
  return recipientIds(tx, rule, protocol, {});
}

async function recipientIds(
  tx: Tx,
  rule: AssigneeRule,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
): Promise<string[]> {
  if (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    const grants = await tx.userRole.findMany({
      where: {
        revokedAt: null,
        role: { key: rule.role },
        ...(rule.kind === "PANEL_ROLE_OF_PROTOCOL" ? { OR: [{ panelId: null }, { panelId: protocol.panelId }] } : {}),
      },
      select: { userId: true },
    });
    return [...new Set(grants.map((grant) => grant.userId))];
  }
  const slots = await resolveSlots(tx, rule, protocol, assignments);
  return [...new Set(slots.map((slot) => slot.userId).filter((id): id is string => Boolean(id)))];
}

async function holidaySet(): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({ select: { date: true } });
  return new Set(rows.map((row) => manilaDay(row.date)));
}
