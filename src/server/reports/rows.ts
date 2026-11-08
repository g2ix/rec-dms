import "server-only";
import type { Prisma } from "@prisma/client";
import { ROLE_KEY_LABEL, isRoleKey } from "@/lib/forms/roles";
import { workingDaysRemaining } from "@/lib/reports/days";
import { manilaDay } from "@/lib/workflow/calendar";
import { dueState, type DueState } from "@/lib/workflow/due";
import { readRule } from "@/server/workflow/who";
import type { StepFacts } from "@/server/reports/steps";

export type QueueRow = {
  id: string;
  href: string;
  code: string | null;
  title: string;
  status: string;
  step: string;
  holder: string;
  dueAt: Date | null;
  due: DueState;
  note: string | null;
  updatedAt?: Date | null;
  openedAt?: Date | null;
  askedBy?: string | null;
};

const taskSelect = {
  id: true,
  title: true,
  stepKey: true,
  dueAt: true,
  status: true,
  createdAt: true,
  candidateRule: true,
  assignee: { select: { displayName: true } },
  instance: {
    select: {
      protocol: {
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          leader: { select: { displayName: true } },
        },
      },
    },
  },
} as const;

export type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

export const taskQuery = { select: taskSelect };

export function holderName(tasks: { assignee: { displayName: string } | null; candidateRule?: unknown }[]): string {
  const names = [...new Set(tasks.map((task) => task.assignee?.displayName).filter((name): name is string => Boolean(name)))];
  if (names.length > 0) return names.join(", ");
  const rule = readRule(tasks[0]?.candidateRule);
  if (rule && (rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL") && isRoleKey(rule.role)) {
    return `Unclaimed · ${ROLE_KEY_LABEL[rule.role]}`;
  }
  return tasks.length > 0 ? "Unclaimed" : "—";
}

export function toQueueRow(
  task: TaskRow,
  facts: StepFacts,
  holidays: ReadonlySet<string>,
  now: Date,
  revisionKeys: ReadonlySet<string>,
): QueueRow | null {
  if (!task.instance || !task.stepKey) return null;
  const protocol = task.instance.protocol;
  const revision = revisionKeys.has(task.stepKey);
  const note = revision && task.dueAt ? countdown(task.dueAt, now, holidays) : null;
  return {
    id: task.id,
    href: `/app/protocols/${protocol.id}`,
    code: protocol.code,
    title: protocol.title,
    status: protocol.status,
    step: task.title || facts.name(task.stepKey),
    holder: holderName([task]),
    dueAt: task.dueAt,
    due: dueState(task.dueAt, now),
    note,
    openedAt: task.createdAt,
    askedBy: protocol.leader.displayName,
  };
}

export function countdown(due: Date, now: Date, holidays: ReadonlySet<string>): string {
  const days = workingDaysRemaining(due, now, holidays);
  if (days < 0) return `${Math.abs(days)} working days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "1 working day left";
  return `${days} working days left`;
}

export async function holidaySet(tx: Prisma.TransactionClient): Promise<Set<string>> {
  const rows = await tx.holiday.findMany({ select: { date: true } });
  return new Set(rows.map((row) => manilaDay(row.date)));
}
