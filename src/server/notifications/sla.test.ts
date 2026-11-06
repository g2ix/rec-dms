import type { WorkflowGraph } from "@/lib/workflow/graph";
import { addDuration, manilaDay, subtractDuration } from "@/lib/workflow/calendar";
import { fromZonedTime } from "date-fns-tz";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { backoffMs, processDueJobs } from "@/server/jobs/runner";
import { setTransactionalMail } from "@/server/mail";
import { scanSla } from "@/server/notifications/sla";
import { makeUser } from "@/server/test/users";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { publishWorkflow } from "@/server/workflow/definitions";
import { completeTask, startInstance } from "@/server/workflow/engine";

const HOLIDAY = "2026-11-09";
const holidays = new Set([HOLIDAY]);
const friday = fromZonedTime("2026-11-06T09:00:00.000", "Asia/Manila");

afterEach(() => {
  setTransactionalMail(null);
});

async function grant(userId: string, key: string) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, scope: "GLOBAL" },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
}

async function protocolFor(userId: string, title: string) {
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId } });
  return createProtocolForUser(userId, {
    title,
    researchType: "Basic",
    affiliation: {
      kind: "STUDENT",
      course: "BS Biology",
      yearLabel: "1st year",
      institution: "University of San Carlos",
      contactEmailId: email.id,
    },
  });
}

async function publishGraph(userId: string, key: string, graph: WorkflowGraph) {
  const definition = await prisma.workflowDefinition.create({
    data: { key, name: key, submissionType: "INITIAL" },
  });
  const version = await prisma.workflowVersion.create({
    data: { definitionId: definition.id, number: 1, status: "DRAFT", graph: toJson(graph) },
  });
  return publishWorkflow(version.id, userId);
}

async function holiday() {
  const date = new Date(`${HOLIDAY}T00:00:00.000Z`);
  await prisma.holiday.upsert({
    where: { date },
    create: { date, name: "Special non-working day" },
    update: {},
  });
}

describe("deadline notices", () => {
  it("reminds, marks overdue, and escalates once across a weekend and a holiday", async () => {
    await holiday();
    const due = addDuration(friday, 3, "WORKING_DAYS", holidays);
    const remind = subtractDuration(due, 1, "WORKING_DAYS", holidays);
    expect(manilaDay(due)).toBe("2026-11-12");
    expect(manilaDay(remind)).toBe("2026-11-11");

    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const chair = await makeUser({ email: `chair.${suffix}@usc.edu.ph`, familyName: "Chair" });
    await grant(chair.id, "REC_CHAIR");
    const created = await protocolFor(leader.id, `Deadline ${suffix}`);
    const key = `SLA_${suffix}`;
    await publishGraph(leader.id, key, {
      startStep: "screen",
      steps: [
        {
          key: "screen",
          name: "Screen the submission",
          type: "TASK",
          assignee: { kind: "PROTOCOL_LEADER" },
          deadline: {
            amount: 3,
            unit: "WORKING_DAYS",
            remindBefore: [{ amount: 1, unit: "WORKING_DAYS" }],
            escalateTo: { kind: "ROLE", role: "REC_CHAIR" },
          },
          notify: { onDueSoon: "task.due_soon", onOverdue: "task.overdue" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "screen", to: "end" }],
    });
    const instance = await startInstance(key, created.protocol.id, created.version.id, leader.id);
    const task = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, status: "OPEN" } });
    await prisma.task.update({ where: { id: task.id }, data: { dueAt: due } });

    const notices = (type: string) => prisma.notification.count({ where: { taskId: task.id, type } });
    await scanSla(new Date(remind.getTime() - 60_000));
    expect(await notices("task.due_soon")).toBe(0);
    await scanSla(remind);
    expect(await notices("task.due_soon")).toBe(1);
    await scanSla(remind);
    expect(await notices("task.due_soon")).toBe(1);

    await scanSla(due);
    expect(await notices("task.overdue")).toBe(1);
    expect(await notices("task.escalated")).toBe(1);
    expect(await prisma.auditEvent.count({ where: { action: "task.escalated", entityId: task.id } })).toBe(1);
    const escalated = await prisma.notification.findFirstOrThrow({ where: { taskId: task.id, type: "task.escalated" } });
    expect(escalated.userId).toBe(chair.id);

    await scanSla(new Date(due.getTime() + 60 * 60 * 1000));
    expect(await notices("task.due_soon")).toBe(1);
    expect(await notices("task.overdue")).toBe(1);
    expect(await notices("task.escalated")).toBe(1);
  }, 60_000);

  it("reminds a revision 5 and 1 working days ahead, then lapses once", async () => {
    await holiday();
    const due = addDuration(friday, 5, "WORKING_DAYS", holidays);
    const five = subtractDuration(due, 5, "WORKING_DAYS", holidays);
    const one = subtractDuration(due, 1, "WORKING_DAYS", holidays);
    expect(manilaDay(due)).toBe("2026-11-16");
    expect(manilaDay(five)).toBe("2026-11-06");
    expect(manilaDay(one)).toBe("2026-11-13");

    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `revise.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const created = await protocolFor(leader.id, `Revise ${suffix}`);
    const key = `WAIT_${suffix}`;
    await publishGraph(leader.id, key, {
      startStep: "wait",
      steps: [
        {
          key: "wait",
          name: "Await the revised protocol",
          type: "WAIT_PROPONENT",
          assignee: { kind: "PROTOCOL_LEADER" },
          deadline: { amount: 5, unit: "WORKING_DAYS" },
        },
        { key: "end", name: "Lapsed", type: "END", statusLabel: "Lapsed" },
      ],
      transitions: [{ from: "wait", to: "end", when: { "==": [{ var: "outcome" }, "OVERDUE"] } }],
    });
    const instance = await startInstance(key, created.protocol.id, created.version.id, leader.id);
    const task = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, status: "OPEN" } });
    await prisma.task.update({ where: { id: task.id }, data: { dueAt: due } });
    const notices = (type: string) => prisma.notification.count({ where: { taskId: task.id, type } });

    await scanSla(five);
    expect(await notices("protocol.revision_due_soon")).toBe(1);
    await scanSla(five);
    expect(await notices("protocol.revision_due_soon")).toBe(1);

    await scanSla(one);
    expect(await notices("protocol.revision_due_soon")).toBe(2);
    await scanSla(one);
    expect(await notices("protocol.revision_due_soon")).toBe(2);

    await scanSla(due);
    expect(await notices("protocol.lapsed")).toBe(1);
    const closed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.outcome).toBe("OVERDUE");
    await scanSla(new Date(due.getTime() + 60_000));
    expect(await notices("protocol.lapsed")).toBe(1);
  }, 60_000);
});

describe("notification delivery", () => {
  it("emails each assigned reviewer once, with a link to the task", async () => {
    const sent: { to: string; text: string; html: string }[] = [];
    setTransactionalMail({
      async send(message) {
        sent.push(message);
      },
    });
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `assign.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const first = await makeUser({ email: `rev1.${suffix}@usc.edu.ph`, familyName: "One" });
    const second = await makeUser({ email: `rev2.${suffix}@usc.edu.ph`, familyName: "Two" });
    await grant(first.id, "PRIMARY_REVIEWER");
    await grant(second.id, "PRIMARY_REVIEWER");
    const created = await protocolFor(leader.id, `Assign ${suffix}`);
    const key = `REV_${suffix}`;
    await publishGraph(leader.id, key, {
      startStep: "assign",
      steps: [
        {
          key: "assign",
          name: "Assign reviewers",
          type: "DECISION",
          assignee: { kind: "PROTOCOL_LEADER" },
          outcomes: [{ key: "GO", label: "Continue" }],
          assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 2, max: 2 },
        },
        {
          key: "review",
          name: "Assess the protocol",
          type: "PARALLEL_TASK",
          assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "assign" },
          parallel: { completeWhen: "ALL" },
          notify: { onAssigned: "task.assigned" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "assign", to: "review", when: { "==": [{ var: "outcome" }, "GO"] } },
        { from: "review", to: "end" },
      ],
    });
    const instance = await startInstance(key, created.protocol.id, created.version.id, leader.id);
    const assign = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, stepKey: "assign" } });
    await completeTask(assign.id, leader.id, { outcome: "GO", reviewerUserIds: [first.id, second.id] });
    await processDueJobs();

    const notes = await prisma.notification.findMany({ where: { type: "task.assigned", userId: { in: [first.id, second.id] } } });
    expect(notes).toHaveLength(2);
    const mailed = sent.filter((message) => message.to === first.email || message.to === second.email);
    expect(mailed).toHaveLength(2);
    expect(mailed.every((message) => message.text.includes("/app/tasks") && message.html.includes("/app/tasks"))).toBe(true);
  }, 60_000);

  it("retries a failed send and marks it failed after five attempts without blocking another job", async () => {
    const sent: string[] = [];
    setTransactionalMail({
      async send(message) {
        if (message.to.includes("bounce.")) throw new Error("smtp down");
        sent.push(message.to);
      },
    });
    const suffix = crypto.randomUUID().slice(0, 8);
    const bounce = await makeUser({ email: `bounce.${suffix}@usc.edu.ph` });
    const fine = await makeUser({ email: `fine.${suffix}@usc.edu.ph` });
    const runAt = new Date();
    await prisma.job.create({
      data: {
        kind: "NOTIFY",
        payload: { templateKey: "task.assigned", userIds: [bounce.id], variables: { taskName: "Screen", link: "https://rec.example.edu/app/tasks" } },
        runAt,
      },
    });
    await prisma.job.create({
      data: {
        kind: "NOTIFY",
        payload: { templateKey: "account.approved", userIds: [fine.id], variables: { link: "https://rec.example.edu/app" } },
        runAt,
      },
    });

    let cursor = runAt;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await processDueJobs({ now: cursor });
      cursor = new Date(cursor.getTime() + backoffMs(attempt + 1) + 1000);
    }

    const failed = await prisma.notification.findFirstOrThrow({ where: { userId: bounce.id, type: "task.assigned" } });
    expect(failed.emailStatus).toBe("FAILED");
    const job = await prisma.job.findFirstOrThrow({ where: { lastError: { contains: "smtp down" } } });
    expect(job.attempts).toBe(5);
    expect(job.doneAt).toBeTruthy();
    expect(job.lastError).toContain("smtp down");
    expect(sent).toContain(fine.email);
    const ok = await prisma.notification.findFirstOrThrow({ where: { userId: fine.id } });
    expect(ok.emailStatus).toBe("SENT");
  }, 60_000);
});
