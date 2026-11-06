import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export const LOAD_EMAIL = "load-seed@example.com";
const GRAPH_KEY = "LOAD_DASHBOARD";
const SCREEN = "load_screen";
const RELEASE = "load_release";
const MEETING = "load_meeting";
const WAIT = "load_wait";

const graph = {
  startStep: SCREEN,
  steps: [
    {
      key: SCREEN,
      name: "Screen the submission",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      feeVerifiedOutcomes: ["ACCEPT"],
      outcomes: [{ key: "ACCEPT", label: "Accept" }],
    },
    {
      key: RELEASE,
      name: "Release the decision",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      actions: [{ kind: "GENERATE_DOCUMENTS", hook: "onExit" }],
    },
    {
      key: MEETING,
      name: "Record the meeting",
      type: "TASK",
      assignee: { kind: "ROLE", role: "REC_STAFF" },
      capture: { meetingDate: true },
    },
    { key: WAIT, name: "Await the revised protocol", type: "WAIT_PROPONENT" },
    { key: "end", name: "End", type: "END" },
  ],
  transitions: [
    { from: SCREEN, to: RELEASE },
    { from: RELEASE, to: "end" },
  ],
};

type Db = PrismaClient | Prisma.TransactionClient;

export async function clearLoad(db: Db): Promise<void> {
  const user = await db.user.findUnique({ where: { email: LOAD_EMAIL }, select: { id: true } });
  if (user) {
    await db.task.deleteMany({ where: { instance: { protocol: { createdById: user.id } } } });
    await db.workflowInstance.deleteMany({ where: { protocol: { createdById: user.id } } });
    await db.protocol.deleteMany({ where: { createdById: user.id } });
    await db.userRole.deleteMany({ where: { userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
  }
  const definition = await db.workflowDefinition.findUnique({ where: { key: GRAPH_KEY }, select: { id: true } });
  if (definition) {
    await db.workflowVersion.deleteMany({ where: { definitionId: definition.id } });
    await db.workflowDefinition.delete({ where: { id: definition.id } });
  }
  const panel = await db.panel.findUnique({ where: { code: "LOAD" }, select: { id: true } });
  if (panel) {
    const left = await db.protocol.count({ where: { panelId: panel.id } });
    if (left === 0) await db.panel.delete({ where: { id: panel.id } });
  }
}

/** Inserts protocols spread across screening, release, meeting, and revision steps. */
export async function insertLoad(db: Db, count = 5000): Promise<{ userId: string }> {
  const user = await db.user.create({
    data: {
      firstName: "Load",
      familyName: "Seed",
      displayName: "Load Seed",
      email: LOAD_EMAIL,
      status: "ACTIVE",
    },
  });
  const role = await db.role.upsert({
    where: { key: "REC_STAFF" },
    update: {},
    create: { key: "REC_STAFF", name: "REC Staff", scope: "GLOBAL" },
  });
  await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
  const panel = await db.panel.upsert({
    where: { code: "LOAD" },
    update: {},
    create: { code: "LOAD", name: "Load panel" },
  });
  const definition = await db.workflowDefinition.create({
    data: { key: GRAPH_KEY, name: "Load dashboard", submissionType: "INITIAL" },
  });
  const version = await db.workflowVersion.create({
    data: { definitionId: definition.id, number: 1, status: "PUBLISHED", graph, publishedAt: new Date() },
  });
  const steps = [SCREEN, SCREEN, RELEASE, MEETING, WAIT];
  const now = Date.now();
  for (let offset = 0; offset < count; offset += 500) {
    const size = Math.min(500, count - offset);
    const protocols = Array.from({ length: size }, (_, index) => {
      const n = offset + index;
      return {
        id: randomUUID(),
        title: `Load protocol ${n}`,
        code: `LOAD-${String(n).padStart(5, "0")}`,
        leaderUserId: user.id,
        createdById: user.id,
        panelId: panel.id,
        reviewType: n % 3 === 0 ? "FULL" as const : "EXPEDITED" as const,
        status: "Under Review",
      };
    });
    await db.protocol.createMany({ data: protocols });
    await db.protocolMember.createMany({
      data: protocols.map((protocol) => ({
        protocolId: protocol.id,
        userId: user.id,
        role: "PROPONENT" as const,
        status: "ACTIVE",
        isLeader: true,
        rosterOrder: 1,
      })),
    });
    const versions = protocols.map((protocol) => ({
      id: randomUUID(),
      protocolId: protocol.id,
      number: 1,
      label: "1",
      state: "SUBMITTED" as const,
      submittedAt: new Date(now - 86_400_000),
    }));
    await db.protocolVersion.createMany({ data: versions });
    const instances = versions.map((row, index) => ({
      id: randomUUID(),
      versionId: version.id,
      protocolId: row.protocolId,
      protocolVersionId: row.id,
      status: "RUNNING" as const,
      currentStepKeys: [steps[(offset + index) % steps.length]!],
    }));
    await db.workflowInstance.createMany({ data: instances });
    await db.task.createMany({
      data: instances.map((instance, index) => {
        const step = steps[(offset + index) % steps.length]!;
        const overdue = step === WAIT && index % 2 === 0;
        return {
          instanceId: instance.id,
          stepKey: step,
          status: "OPEN",
          kind: "MAIN",
          title: step,
          candidateRule: { kind: "ROLE", role: "REC_STAFF" },
          dueAt: overdue ? new Date(now - 86_400_000) : new Date(now + 86_400_000),
          createdAt: new Date(now - (offset + index) * 1000),
        };
      }),
    });
  }
  return { userId: user.id };
}
