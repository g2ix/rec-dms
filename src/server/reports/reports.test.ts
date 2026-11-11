import { fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma, useAppSchema } from "@/server/db";
import { reportCsv } from "@/server/reports/query";
import { meetingGroups } from "@/server/reports/meetings";
import { dashboardIn } from "@/server/reports/dashboard";
import { turnaroundSamples } from "@/server/reports/turnaround";
import { makeUser } from "@/server/test/users";
import { inboxFor } from "@/server/workflow/read";
import { openTasks } from "@/server/workflow/inbox";

const graph = {
  startStep: "m11_screen",
  steps: [
    {
      key: "m11_screen",
      name: "Screen the submission",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      feeVerifiedOutcomes: ["ACCEPT"],
      outcomes: [{ key: "ACCEPT", label: "Accept" }],
    },
    {
      key: "m11_release",
      name: "Release the decision",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      actions: [{ kind: "GENERATE_DOCUMENTS", hook: "onExit" }],
    },
    {
      key: "m11_meeting",
      name: "Record the meeting",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      capture: { meetingDate: true },
      outcomes: [{ key: "APPROVED", label: "Approved" }],
    },
    { key: "end", name: "End", type: "END" },
  ],
  transitions: [
    { from: "m11_screen", to: "m11_release" },
    { from: "m11_release", to: "end" },
  ],
};

function noon(day: string): Date {
  return fromZonedTime(`${day}T12:00:00`, "Asia/Manila");
}

async function inTx<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return run(tx);
  });
}

async function grant(userId: string, key: string, panelId?: string) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, scope: panelId ? "PANEL" : "GLOBAL" },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id, panelId: panelId ?? null } });
}

describe("dashboards and reports", () => {
  it("keeps the dashboard count equal to the task inbox and applies each role view", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const person = await makeUser({ email: `view.${suffix}@usc.edu.ph`, familyName: "View" });
    const other = await makeUser({ email: `other.${suffix}@usc.edu.ph`, familyName: "Other" });
    const panelA = await prisma.panel.create({ data: { code: `A${suffix}`, name: `Panel A ${suffix}` } });
    const panelB = await prisma.panel.create({ data: { code: `B${suffix}`, name: `Panel B ${suffix}` } });
    await grant(person.id, "REC_STAFF");
    await grant(person.id, "PANEL_CHAIR", panelA.id);
    const definition = await prisma.workflowDefinition.create({
      data: { key: `M11_${suffix}`, name: "M11", submissionType: "INITIAL" },
    });
    const version = await prisma.workflowVersion.create({
      data: { definitionId: definition.id, number: 1, status: "DRAFT", graph: { startStep: "x", steps: [{ key: "x", name: "X", type: "TASK" }], transitions: [] } },
    });
    const protocol = await prisma.protocol.create({
      data: { title: `View ${suffix}`, leaderUserId: person.id, createdById: person.id, panelId: panelA.id },
    });
    const otherProtocol = await prisma.protocol.create({
      data: { title: `Other ${suffix}`, leaderUserId: other.id, createdById: other.id, panelId: panelB.id },
    });
    const protocolVersion = await prisma.protocolVersion.create({ data: { protocolId: protocol.id, number: 1, label: "1" } });
    const otherVersion = await prisma.protocolVersion.create({ data: { protocolId: otherProtocol.id, number: 1, label: "1" } });
    const instance = await prisma.workflowInstance.create({
      data: {
        versionId: version.id,
        protocolId: protocol.id,
        protocolVersionId: protocolVersion.id,
        assignments: { m11_review: [person.id] },
      },
    });
    const otherInstance = await prisma.workflowInstance.create({
      data: { versionId: version.id, protocolId: otherProtocol.id, protocolVersionId: otherVersion.id },
    });
    const leader = await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "submit", status: "OPEN", candidateRule: { kind: "PROTOCOL_LEADER" }, title: "Submit" },
    });
    const staff = await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "screen", status: "OPEN", candidateRule: { kind: "ROLE", role: "REC_STAFF" }, title: "Screen" },
    });
    const chair = await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "decide", status: "OPEN", candidateRule: { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" }, title: "Decide" },
    });
    await prisma.task.create({
      data: { instanceId: otherInstance.id, stepKey: "decide", status: "OPEN", candidateRule: { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" }, title: "Elsewhere" },
    });
    const review = await prisma.task.create({
      data: {
        instanceId: instance.id,
        stepKey: "m11_review",
        status: "OPEN",
        assigneeUserId: null,
        candidateRule: { kind: "ASSIGNED_IN_STEP", stepKey: "m11_review" },
        title: "Assess",
      },
    });
    await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "theirs", status: "OPEN", assigneeUserId: other.id, candidateRule: { kind: "PROTOCOL_LEADER" }, title: "Not mine" },
    });

    const mine = async (view: "proponent" | "staff" | "panel-chair" | "reviewer") => {
      const { ids } = await inTx((tx) => openTasks(tx, person.id, view));
      const tasks = await prisma.task.findMany({ where: { id: { in: ids }, instance: { protocolId: { in: [protocol.id, otherProtocol.id] } } }, select: { id: true } });
      return tasks.map((task) => task.id).sort();
    };
    expect(await mine("proponent")).toEqual([leader.id].sort());
    expect(await mine("staff")).toEqual([staff.id].sort());
    expect(await mine("panel-chair")).toEqual([chair.id].sort());
    expect(await mine("reviewer")).toEqual([review.id].sort());

    const inbox = await inboxFor(person.id, "proponent");
    const dashboard = await inTx((tx) => dashboardIn(tx, person.id, "proponent"));
    expect(dashboard.view).toBe("proponent");
    if (dashboard.view === "proponent") expect(dashboard.waiting.total).toBe(inbox.length);
  });

  it("computes turnaround from screening completion and limits a panel chair export to that panel", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const chair = await makeUser({ email: `chair.${suffix}@usc.edu.ph`, familyName: "Chair" });
    const outsider = await makeUser({ email: `out.${suffix}@usc.edu.ph`, familyName: "Out" });
    const panelA = await prisma.panel.create({ data: { code: `P${suffix}A`, name: `Owned ${suffix}` } });
    const panelB = await prisma.panel.create({ data: { code: `P${suffix}B`, name: `Other ${suffix}` } });
    await grant(chair.id, "PANEL_CHAIR", panelA.id);
    const definition = await prisma.workflowDefinition.create({
      data: { key: `M11T_${suffix}`, name: "M11 turnaround", submissionType: "INITIAL" },
    });
    await prisma.workflowVersion.create({
      data: { definitionId: definition.id, number: 1, status: "PUBLISHED", graph, publishedAt: new Date() },
    });
    const version = await prisma.workflowVersion.findFirstOrThrow({ where: { definitionId: definition.id } });

    async function cycle(panelId: string, code: string, reviewType: "EXPEDITED" | "FULL", started: string, released: string) {
      const protocol = await prisma.protocol.create({
        data: { code, title: code, leaderUserId: chair.id, createdById: chair.id, panelId, reviewType, status: "Approved" },
      });
      const protocolVersion = await prisma.protocolVersion.create({
        data: { protocolId: protocol.id, number: 1, label: "1", state: "SUBMITTED", submittedAt: noon(started) },
      });
      const instance = await prisma.workflowInstance.create({
        data: { versionId: version.id, protocolId: protocol.id, protocolVersionId: protocolVersion.id, status: "COMPLETED" },
      });
      await prisma.task.create({
        data: { instanceId: instance.id, stepKey: "m11_screen", status: "COMPLETED", outcome: "ACCEPT", completedAt: noon(started) },
      });
      await prisma.task.create({
        data: { instanceId: instance.id, stepKey: "m11_release", status: "COMPLETED", completedAt: noon(released) },
      });
      return protocolVersion.id;
    }

    const owned = await cycle(panelA.id, `OWN-${suffix}`, "EXPEDITED", "2026-01-01", "2026-01-29");
    await cycle(panelA.id, `OWN2-${suffix}`, "EXPEDITED", "2026-01-01", "2026-02-10");
    await cycle(panelA.id, `FULL-${suffix}`, "FULL", "2026-03-02", "2026-04-20");
    await cycle(panelA.id, `FULL2-${suffix}`, "FULL", "2026-03-02", "2026-04-30");
    await cycle(panelB.id, `OTHER-${suffix}`, "EXPEDITED", "2026-01-01", "2026-01-11");

    const pairs = await inTx(async (tx) => turnaroundSamples(tx, await (await import("@/server/reports/steps")).stepFacts(tx), { kind: "versions", versionIds: [owned] }));
    expect(pairs.map((pair) => pair.days)).toEqual([28]);

    const summary = await inTx(async (tx) => {
      const facts = await (await import("@/server/reports/steps")).stepFacts(tx);
      const samples = await turnaroundSamples(tx, facts, { kind: "panels", panelIds: [panelA.id] });
      const { summarizeTurnaround } = await import("@/lib/reports/metrics");
      return summarizeTurnaround(samples.filter((sample) => sample.versionId));
    });
    // Same hand count as metrics.test.ts: expedited 28 and 40, full 49 and 59.
    expect(summary.find((row) => row.reviewType === "EXPEDITED")).toMatchObject({ medianDays: 34, p90Days: 40, withinLimit: 1, count: 2 });
    expect(summary.find((row) => row.reviewType === "FULL")).toMatchObject({ medianDays: 54, p90Days: 59, withinLimit: 1, count: 2 });

    const csv = await reportCsv(chair.id, {});
    expect(csv).toContain(`OWN-${suffix}`);
    expect(csv).toContain(`FULL-${suffix}`);
    expect(csv).not.toContain(`OTHER-${suffix}`);
    await expect(reportCsv(chair.id, { panelId: panelB.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reportCsv(outsider.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("moves a late full review to the following meeting from the schedule setting and flags the cutoff", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await prisma.setting.upsert({
      where: { key: "meetings.schedule" },
      create: { key: "meetings.schedule", value: { default: { weekday: 5, week: 2, cutoffDays: 14 } } },
      update: { value: { default: { weekday: 5, week: 2, cutoffDays: 14 } } },
    });
    const staff = await makeUser({ email: `meet.${suffix}@usc.edu.ph`, familyName: "Staff" });
    await grant(staff.id, "REC_STAFF");
    const definition = await prisma.workflowDefinition.create({
      data: { key: `M11M_${suffix}`, name: "M11 meeting", submissionType: "INITIAL" },
    });
    const version = await prisma.workflowVersion.create({
      data: { definitionId: definition.id, number: 1, status: "PUBLISHED", graph, publishedAt: new Date() },
    });
    const protocol = await prisma.protocol.create({
      data: { code: `MEET-${suffix}`, title: `Meeting ${suffix}`, leaderUserId: staff.id, createdById: staff.id, reviewType: "FULL", status: "Under Review" },
    });
    const protocolVersion = await prisma.protocolVersion.create({
      data: { protocolId: protocol.id, number: 1, label: "1", state: "SUBMITTED", submittedAt: noon("2026-11-01") },
    });
    const instance = await prisma.workflowInstance.create({
      data: { versionId: version.id, protocolId: protocol.id, protocolVersionId: protocolVersion.id, currentStepKeys: ["m11_meeting"] },
    });
    await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "m11_screen", status: "COMPLETED", outcome: "ACCEPT", completedAt: noon("2026-11-01") },
    });
    await prisma.task.create({
      data: { instanceId: instance.id, stepKey: "m11_meeting", status: "OPEN", candidateRule: { kind: "ROLE", role: "REC_STAFF" }, title: "Meeting" },
    });
    const groups = await meetingGroups(staff.id, noon("2026-11-06"));
    const row = groups.flatMap((group) => group.rows.map((item) => ({ ...item, meeting: group.meeting }))).find((item) => item.code === `MEET-${suffix}`);
    expect(row).toMatchObject({ meeting: "2026-12-11", missedCutoff: true });
  });
});
