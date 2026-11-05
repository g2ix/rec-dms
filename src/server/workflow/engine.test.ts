import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { manilaDay } from "@/lib/workflow/calendar";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { prisma, useAppSchema } from "@/server/db";
import { createDefinition, publishDefinition } from "@/server/forms/definitions";
import { saveField } from "@/server/forms/fill";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { confirmUpload, prepareUpload } from "@/server/protocols/uploads";
import { putObject } from "@/server/storage";
import { makeUser } from "@/server/test/users";
import { toJson } from "@/server/forms/json";
import { publishWorkflow } from "@/server/workflow/definitions";
import {
  cancelInstance,
  claimTask,
  completeLeaderSubmissionTx,
  completeTask,
  maybeStartInitial,
  maybeStartResubmissionTx,
  reassignTask,
  startInstance,
} from "@/server/workflow/engine";

const noteSchema = {
  sections: [
    {
      id: "main",
      title: "Main",
      fields: [
        { id: "note", label: "Note", type: "text", fillers: ["PROPONENT"], validation: { required: true } },
      ],
    },
  ],
};

async function grant(userId: string, key: string) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, scope: "GLOBAL" },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id } });
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

async function grantOnPanel(userId: string, key: string, panelId: string) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, scope: "PANEL" },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id, panelId } });
}

async function publishInitial(userId: string, graph: WorkflowGraph) {
  let definition = await prisma.workflowDefinition.findUnique({ where: { key: "INITIAL_SUBMISSION" } });
  if (!definition) {
    definition = await prisma.workflowDefinition.create({
      data: { key: "INITIAL_SUBMISSION", name: "Initial submission", submissionType: "INITIAL" },
    });
  }
  const max = await prisma.workflowVersion.aggregate({
    where: { definitionId: definition.id },
    _max: { number: true },
  });
  const version = await prisma.workflowVersion.create({
    data: {
      definitionId: definition.id,
      number: (max._max.number ?? 0) + 1,
      status: "DRAFT",
      graph: toJson(graph),
    },
  });
  return publishWorkflow(version.id, userId);
}

async function inTx<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return run(tx);
  }, { timeout: 20_000, maxWait: 10_000 });
}

async function protocolFor(userId: string, title: string) {
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId } });
  return createProtocolForUser(userId, {
    title,
    researchType: "Basic",
    affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "1st year", institution: "University of San Carlos", contactEmailId: email.id },
  });
}

describe("workflow engine", () => {
  it("assigns a code, stops on a missing transition, completes parallel work, and cancels", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const co = await makeUser({ email: `co.${suffix}@usc.edu.ph`, familyName: "Co" });
    const created = await protocolFor(leader.id, `Auto ${suffix}`);
    await prisma.protocolMember.create({
      data: { protocolId: created.protocol.id, userId: co.id, role: "PROPONENT", status: "ACTIVE", rosterOrder: 2 },
    });

    await publishGraph(leader.id, `AUTO_${suffix}`, {
      startStep: "code",
      steps: [
        { key: "code", name: "Assign code", type: "AUTO", actions: [{ kind: "ASSIGN_PROTOCOL_CODE" }] },
        { key: "end", name: "End", type: "END", statusLabel: "Approved" },
      ],
      transitions: [{ from: "code", to: "end" }],
    });
    const auto = await startInstance(`AUTO_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const coded = await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } });
    expect(coded.code).toMatch(/^USC-REC-\d{4}-\d{4}$/);
    expect(auto.status).toBe("COMPLETED");

    await publishGraph(leader.id, `STUCK_${suffix}`, {
      startStep: "decide",
      steps: [
        {
          key: "decide",
          name: "Decide",
          type: "DECISION",
          assignee: { kind: "PROTOCOL_LEADER" },
          outcomes: [{ key: "YES", label: "Yes" }],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "decide", to: "end", when: { and: [{ "==": [{ var: "outcome" }, "YES"] }, { "==": [1, 0] }] } }],
    });
    const stuck = await startInstance(`STUCK_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const stuckTask = await prisma.task.findFirstOrThrow({ where: { instanceId: stuck.id, status: "OPEN" } });
    await expect(completeTask(stuckTask.id, co.id, { outcome: "YES" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(completeTask(stuckTask.id, leader.id, { outcome: "YES" })).rejects.toMatchObject({ code: "NO_TRANSITION" });

    await publishGraph(leader.id, `ANY_${suffix}`, {
      startStep: "both",
      steps: [
        {
          key: "both",
          name: "Either",
          type: "PARALLEL_TASK",
          assignee: { kind: "PROTOCOL_PROPONENTS" },
          parallel: { completeWhen: "ANY" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "both", to: "end" }],
    });
    const anyRun = await startInstance(`ANY_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const anyTasks = await prisma.task.findMany({ where: { instanceId: anyRun.id, status: "OPEN" } });
    expect(anyTasks).toHaveLength(2);
    await completeTask(anyTasks[0]!.id, anyTasks[0]!.assigneeUserId!);
    const cancelled = await prisma.task.count({ where: { instanceId: anyRun.id, status: "CANCELLED" } });
    expect(cancelled).toBe(1);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: anyRun.id } })).status).toBe("COMPLETED");

    await publishGraph(leader.id, `LEAST_${suffix}`, {
      startStep: "both",
      steps: [
        {
          key: "both",
          name: "At least one",
          type: "PARALLEL_TASK",
          assignee: { kind: "PROTOCOL_PROPONENTS" },
          parallel: { completeWhen: { atLeast: 1 } },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "both", to: "end" }],
    });
    const least = await startInstance(`LEAST_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const leastTask = await prisma.task.findFirstOrThrow({ where: { instanceId: least.id, assigneeUserId: leader.id, status: "OPEN" } });
    await completeTask(leastTask.id, leader.id);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: least.id } })).status).toBe("COMPLETED");

    await publishGraph(leader.id, `CANCEL_${suffix}`, {
      startStep: "hold",
      steps: [
        { key: "hold", name: "Hold", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "hold", to: "end" }],
    });
    const running = await startInstance(`CANCEL_${suffix}`, created.protocol.id, created.version.id, leader.id);
    await cancelInstance(running.id, leader.id);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("CANCELLED");
    await cancelInstance(running.id, leader.id);
  }, 120_000);

  it("runs a five-step review with a return loop and keeps the pinned version", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `leader.${suffix}@usc.edu.ph` });
    const staffA = await makeUser({ email: `staff.a.${suffix}@usc.edu.ph`, familyName: "StaffA" });
    const staffB = await makeUser({ email: `staff.b.${suffix}@usc.edu.ph`, familyName: "StaffB" });
    const reviewerA = await makeUser({ email: `rev.a.${suffix}@usc.edu.ph`, familyName: "ReviewA" });
    const reviewerB = await makeUser({ email: `rev.b.${suffix}@usc.edu.ph`, familyName: "ReviewB" });
    await grant(staffA.id, "REC_STAFF");
    await grant(staffB.id, "REC_STAFF");
    await grant(reviewerA.id, "PRIMARY_REVIEWER");
    await grant(reviewerB.id, "PRIMARY_REVIEWER");
    const form = await createDefinition({
      code: `F-${suffix.slice(0, 4).toUpperCase()}`,
      title: "Workflow note",
      version: "1",
      effectiveDate: "2026-11-05",
      schema: noteSchema,
      userId: leader.id,
    });
    await publishDefinition(form.id, leader.id);
    const graph = fiveStep(form.code);
    const version1 = await publishGraph(leader.id, "INITIAL_SUBMISSION", graph);

    const created = await protocolFor(leader.id, `Review ${suffix}`);
    const open = await prisma.task.findFirstOrThrow({
      where: { instance: { protocolId: created.protocol.id, status: "RUNNING" }, status: "OPEN" },
    });
    await expect(completeTask(open.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });
    const formCopy = await prisma.formInstance.findFirstOrThrow({
      where: { ownerId: created.version.id, formDefinition: { code: form.code } },
    });
    await saveField({ instanceId: formCopy.id, path: "note", value: "Ready", expectedRevision: 0, userId: leader.id });
    await expect(completeTask(open.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });
    const prepared = await prepareUpload({
      protocolId: created.protocol.id,
      userId: leader.id,
      kind: "MANUSCRIPT",
      originalName: "manuscript.pdf",
      mime: "application/pdf",
    });
    await putObject(prepared.storageKey, Buffer.from("%PDF-1.4 test"), "application/pdf");
    await confirmUpload({ intentId: prepared.intentId, userId: leader.id });
    const submitted = await completeTask(open.id, leader.id);
    expect(submitted.currentStepKeys).toEqual(["screen"]);
    expect((await prisma.protocolVersion.findUniqueOrThrow({ where: { id: created.version.id } })).state).toBe("SUBMITTED");
    expect(await prisma.job.count({ where: { kind: "NOTIFY", payload: { path: ["protocolId"], equals: created.protocol.id } } })).toBeGreaterThan(0);

    const draft = await prisma.workflowVersion.create({
      data: { definitionId: version1.definitionId, number: 2, status: "DRAFT", graph: toJson(graph) },
    });
    const version2 = await publishWorkflow(draft.id, leader.id);
    const other = await protocolFor(leader.id, `Later ${suffix}`);
    const pinned = await prisma.workflowInstance.findFirstOrThrow({
      where: { protocolId: created.protocol.id, status: "RUNNING" },
      include: { version: true },
    });
    const newer = await prisma.workflowInstance.findFirstOrThrow({
      where: { protocolId: other.protocol.id, status: "RUNNING" },
      include: { version: true },
    });
    expect(pinned.version.number).toBe(1);
    expect(newer.versionId).toBe(version2.id);
    expect(pinned.versionId).toBe(version1.id);

    const screen = await prisma.task.findFirstOrThrow({ where: { instanceId: pinned.id, stepKey: "screen", status: "OPEN" } });
    expect(screen.assigneeUserId).toBeNull();
    expect(screen.dueAt).toBeTruthy();
    await expect(claimTask(screen.id, reviewerA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await claimTask(screen.id, staffA.id);
    const moved = await reassignTask(screen.id, staffA.id, staffB.id, "Covering the desk");
    await expect(reassignTask(screen.id, reviewerA.id, staffA.id, "No")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await completeTask(moved, staffB.id, { outcome: "RETURN" });
    const waiting = await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } });
    expect(waiting.status).toBe("Awaiting Revision");
    const revise = await prisma.task.findFirstOrThrow({ where: { instanceId: pinned.id, stepKey: "revise", status: "OPEN" } });
    expect(revise.dueAt).toBeTruthy();
    await completeTask(revise.id, leader.id);
    const again = await prisma.task.findFirstOrThrow({ where: { instanceId: pinned.id, stepKey: "submit", status: "OPEN" } });
    await completeTask(again.id, leader.id);

    const screenAgain = await prisma.task.findFirstOrThrow({
      where: { instanceId: pinned.id, stepKey: "screen", status: "OPEN" },
    });
    await expect(
      completeTask(screenAgain.id, staffB.id, { outcome: "ACCEPT", reviewerUserIds: [leader.id, reviewerA.id] }),
    ).rejects.toMatchObject({ code: "COI" });
    await completeTask(screenAgain.id, staffB.id, { outcome: "ACCEPT", reviewerUserIds: [reviewerA.id, reviewerB.id] });
    const reviews = await prisma.task.findMany({ where: { instanceId: pinned.id, stepKey: "review", status: "OPEN" } });
    expect(reviews).toHaveLength(2);
    await completeTask(reviews[0]!.id, reviews[0]!.assigneeUserId!);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: pinned.id } })).status).toBe("RUNNING");
    const finished = await completeTask(reviews[1]!.id, reviews[1]!.assigneeUserId!);
    expect(finished.instanceStatus).toBe("COMPLETED");
    expect(finished.currentStepKeys).toEqual([]);
    const repeat = await completeTask(reviews[1]!.id, reviews[1]!.assigneeUserId!);
    expect(repeat.alreadyCompleted).toBe(true);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } })).status).toBe("Approved");
    const reviewerMember = await prisma.protocolMember.findFirstOrThrow({
      where: { protocolId: created.protocol.id, userId: reviewerA.id },
    });
    expect(reviewerMember.role).toBe("PRIMARY_REVIEWER");
    const events = await prisma.auditEvent.findMany({ where: { protocolId: created.protocol.id }, select: { action: true } });
    const names = new Set(events.map((event) => event.action));
    expect(names.has("workflow.step_entered")).toBe(true);
    expect(names.has("task.completed")).toBe(true);
    expect(names.has("task.reassigned")).toBe(true);
  }, 120_000);

  it("covers codes, child workflows, submission, and the refusal paths", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `edge.lead.${suffix}@usc.edu.ph`, familyName: "EdgeLead" });
    const other = await makeUser({ email: `edge.other.${suffix}@usc.edu.ph`, familyName: "EdgeOther" });
    const chair = await makeUser({ email: `edge.chair.${suffix}@usc.edu.ph`, familyName: "EdgeChair" });
    const staff = await makeUser({ email: `edge.staff.${suffix}@usc.edu.ph`, familyName: "EdgeStaff" });
    await grant(leader.id, "REC_STAFF");
    await grant(staff.id, "REC_STAFF");
    await grant(chair.id, "PRIMARY_REVIEWER");
    const panel = await prisma.panel.create({ data: { code: `P-${suffix}`, name: `Panel ${suffix}` } });
    await grantOnPanel(chair.id, "PANEL_CHAIR", panel.id);

    const note = await createDefinition({
      code: `N${suffix}`,
      title: "Note",
      version: "1",
      effectiveDate: "2026-11-05",
      schema: noteSchema,
      userId: leader.id,
    });
    await publishDefinition(note.id, leader.id);
    const extra = await createDefinition({
      code: `X${suffix}`,
      title: "Extra",
      version: "1",
      effectiveDate: "2026-11-05",
      schema: noteSchema,
      userId: leader.id,
    });
    await publishDefinition(extra.id, leader.id);
    const sign = await createDefinition({
      code: `S${suffix}`,
      title: "Sign",
      version: "1",
      effectiveDate: "2026-11-05",
      schema: {
        sections: [
          {
            id: "main",
            title: "Sign",
            fields: [
              {
                id: "ink",
                label: "Signature",
                type: "signature",
                fillers: ["PROPONENT"],
                signer: { role: "PROPONENT", each: "researchers" },
                validation: { required: true },
              },
            ],
          },
        ],
      },
      userId: leader.id,
    });
    await publishDefinition(sign.id, leader.id);
    const per = await createDefinition({
      code: `P${suffix}`,
      title: "Per reviewer",
      version: "1",
      effectiveDate: "2026-11-05",
      schema: noteSchema,
      userId: leader.id,
    });
    await publishDefinition(per.id, leader.id);

    const year = manilaDay(new Date()).slice(0, 4);
    await prisma.setting.upsert({
      where: { key: "protocol.codePattern" },
      update: { value: "REC-{YYYY}-{####}" },
      create: { key: "protocol.codePattern", value: "REC-{YYYY}-{####}" },
    });
    await prisma.protocol.create({
      data: { title: "Noted", code: `REC-${year}-NOTE`, leaderUserId: leader.id, createdById: leader.id },
    });
    await prisma.protocol.create({
      data: { title: "Numbered", code: `REC-${year}-0003`, leaderUserId: leader.id, createdById: leader.id },
    });
    const bare = await prisma.protocol.create({
      data: { title: `Bare ${suffix}`, leaderUserId: leader.id, createdById: leader.id },
    });
    const bareVersion = await prisma.protocolVersion.create({
      data: { protocolId: bare.id, number: 1, label: "1" },
    });
    await publishGraph(leader.id, `CODE_${suffix}`, {
      startStep: "code",
      steps: [
        {
          key: "code",
          name: "Code",
          type: "AUTO",
          actions: [{ kind: "ASSIGN_PROTOCOL_CODE" }],
          setFields: [
            { path: "protocol.reviewType", from: "outcome" },
            { path: "protocol.panelId", from: "outcome" },
          ],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "code", to: "end" }],
    });
    await startInstance(`CODE_${suffix}`, bare.id, bareVersion.id, leader.id);
    const coded = await prisma.protocol.findUniqueOrThrow({ where: { id: bare.id } });
    expect(coded.code).toBe(`REC-${year}-0004`);
    await startInstance(`CODE_${suffix}`, bare.id, bareVersion.id, leader.id);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: bare.id } })).code).toBe(coded.code);

    await expect(startInstance(`MISSING_${suffix}`, bare.id, bareVersion.id, leader.id)).rejects.toMatchObject({
      code: "WORKFLOW_UNPUBLISHED",
    });
    await publishGraph(leader.id, `LOOP_${suffix}`, {
      startStep: "spin",
      steps: [{ key: "spin", name: "Spin", type: "AUTO" }],
      transitions: [{ from: "spin", to: "spin" }],
    });
    await expect(startInstance(`LOOP_${suffix}`, bare.id, bareVersion.id, leader.id)).rejects.toMatchObject({
      code: "INVALID",
    });
    await publishGraph(leader.id, `ORPHAN_${suffix}`, {
      startStep: "go",
      steps: [
        { key: "go", name: "Go", type: "AUTO", actions: [{ kind: "START_WORKFLOW" }] },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "go", to: "end" }],
    });
    await expect(startInstance(`ORPHAN_${suffix}`, bare.id, bareVersion.id, leader.id)).rejects.toMatchObject({
      code: "INVALID",
    });
    await publishGraph(leader.id, `ALONE_${suffix}`, {
      startStep: "ask",
      steps: [
        { key: "ask", name: "Ask the adviser", type: "TASK", assignee: { kind: "PROTOCOL_ADVISER" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "ask", to: "end" }],
    });
    await expect(startInstance(`ALONE_${suffix}`, bare.id, bareVersion.id, leader.id)).rejects.toMatchObject({
      code: "NO_ASSIGNEE",
    });
    const broken = await publishGraph(leader.id, `BROKEN_${suffix}`, {
      startStep: "hold",
      steps: [
        { key: "hold", name: "Hold", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "hold", to: "end" }],
    });
    await prisma.workflowVersion.update({ where: { id: broken.id }, data: { graph: { nope: true } } });
    await expect(startInstance(`BROKEN_${suffix}`, bare.id, bareVersion.id, null)).rejects.toMatchObject({
      code: "INVALID",
    });

    await publishInitial(leader.id, {
      startStep: "submit",
      steps: [
        {
          key: "submit",
          name: "Submit",
          type: "TASK",
          assignee: { kind: "PROTOCOL_LEADER" },
          notify: { onAssigned: "task.assigned" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "submit", to: "end" }],
    });
    const created = await protocolFor(leader.id, `Edge ${suffix}`);
    await prisma.protocol.update({ where: { id: created.protocol.id }, data: { panelId: panel.id } });
    await prisma.protocolMember.create({
      data: { protocolId: created.protocol.id, userId: other.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 2 },
    });
    await prisma.protocolMember.create({
      data: { protocolId: created.protocol.id, userId: chair.id, role: "REVIEWER", status: "ACTIVE", rosterOrder: 3 },
    });

    await publishGraph(leader.id, `CHILD_${suffix}`, {
      startStep: "wait",
      steps: [
        {
          key: "wait",
          name: "Wait",
          type: "WAIT_PROPONENT",
          deadline: { amount: 1, unit: "CALENDAR_DAYS" },
          forms: [{ code: per.code, mode: "FILL", perAssignee: true, required: false }],
        },
        {
          key: "again",
          name: "Again",
          type: "TASK",
          assignee: { kind: "PROTOCOL_LEADER" },
          forms: [{ code: per.code, mode: "FILL", perAssignee: true, required: false }],
        },
        {
          key: "chair",
          name: "Chair",
          type: "TASK",
          assignee: { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" },
          deadline: { amount: 1, unit: "CALENDAR_DAYS" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "wait", to: "again" },
        { from: "again", to: "chair" },
        { from: "chair", to: "end" },
      ],
    });
    await publishGraph(leader.id, `RICH_${suffix}`, {
      startStep: "mark",
      steps: [
        {
          key: "mark",
          name: "Mark",
          type: "TASK",
          assignee: { kind: "USER", userId: leader.id },
          deadline: { amount: 3, unit: "HOURS", remindBefore: [{ amount: 1, unit: "HOURS" }] },
          forms: [
            { code: note.code, mode: "VIEW", required: true },
            { code: extra.code, mode: "FILL", required: false },
          ],
          uploads: [{ kind: "SUPPORTING", required: false }],
          setFields: [
            { path: "protocol.reviewType", from: "formField" },
            { path: "protocol.status", from: "formField", field: "nodot" },
            { path: "protocol.status", from: "formField", field: `${note.code}.note` },
            { path: "protocol.panelId", from: "formField", field: `${note.code}.panel` },
            { path: "protocol.reviewType", from: "outcome" },
          ],
          notify: {
            onCompleted: "step.done",
            cc: [{ kind: "PROTOCOL_LEADER" }, { kind: "PANEL_ROLE_OF_PROTOCOL", role: "MEMBER_SECRETARY" }],
          },
          actions: [
            { kind: "GENERATE_DOCUMENTS", hook: "onExit", params: { template: "ack" } },
            { kind: "NOTIFY", hook: "onExit", params: { templateKey: "ack" } },
            { kind: "START_WORKFLOW", hook: "onExit", params: { definitionKey: `CHILD_${suffix}` } },
          ],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "mark", to: "end" }],
    });
    await prisma.formDefinition.update({ where: { id: extra.id }, data: { status: "RETIRED" } });
    const rich = await startInstance(`RICH_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const mark = await prisma.task.findFirstOrThrow({ where: { instanceId: rich.id, stepKey: "mark" } });
    expect(mark.dueAt && mark.dueAt.getTime()).toBeGreaterThan(Date.now());
    const copy = await prisma.formInstance.findFirstOrThrow({
      where: { ownerId: created.version.id, formDefinitionId: note.id },
    });
    await prisma.formInstance.update({
      where: { id: copy.id },
      data: { data: { note: "Queued", panel: panel.id } },
    });
    await completeTask(mark.id, leader.id, { outcome: " FULL ", comment: "  Looks ready  " });
    const marked = await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } });
    expect(marked.reviewType).toBe("FULL");
    expect(marked.status).toBe("Queued");
    expect(marked.panelId).toBe(panel.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: mark.id } })).comment).toBe("Looks ready");
    const child = await prisma.workflowInstance.findFirstOrThrow({
      where: { parentInstanceId: rich.id },
    });
    expect(await prisma.job.count({ where: { kind: "GENERATE_DOCUMENTS", payload: { path: ["instanceId"], equals: rich.id } } })).toBe(1);
    const personal = await prisma.formInstance.count({
      where: { ownerId: created.version.id, formDefinitionId: per.id, filledByMemberId: { not: null } },
    });
    expect(personal).toBe(1);
    const wait = await prisma.task.findFirstOrThrow({ where: { instanceId: child.id, stepKey: "wait", status: "OPEN" } });
    await completeTask(wait.id, leader.id);
    const again = await prisma.task.findFirstOrThrow({ where: { instanceId: child.id, stepKey: "again", status: "OPEN" } });
    await completeTask(again.id, leader.id);
    const chairTask = await prisma.task.findFirstOrThrow({ where: { instanceId: child.id, stepKey: "chair", status: "OPEN" } });
    expect(chairTask.assigneeUserId).toBe(chair.id);
    await completeTask(chairTask.id, chair.id);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: child.id } })).status).toBe("COMPLETED");

    await publishGraph(leader.id, `PICK_${suffix}`, {
      startStep: "pick",
      steps: [
        {
          key: "pick",
          name: "Pick",
          type: "DECISION",
          assignee: { kind: "PROTOCOL_LEADER" },
          outcomes: [{ key: "YES", label: "Yes" }],
          assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 1, max: 2 },
        },
        {
          key: "review",
          name: "Review",
          type: "TASK",
          assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "pick" },
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "pick", to: "review", when: { "==": [{ var: "outcome" }, "YES"] } },
        { from: "review", to: "end" },
      ],
    });
    const pickRun = await startInstance(`PICK_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const pick = await prisma.task.findFirstOrThrow({ where: { instanceId: pickRun.id, status: "OPEN" } });
    await expect(completeTask(pick.id, leader.id)).rejects.toMatchObject({ code: "INVALID" });
    await expect(completeTask(pick.id, leader.id, { outcome: "YES", reviewerUserIds: [] })).rejects.toMatchObject({
      code: "INVALID",
    });
    await expect(
      completeTask(pick.id, leader.id, { outcome: "YES", reviewerUserIds: [chair.id, chair.id] }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(
      completeTask(pick.id, leader.id, { outcome: "YES", reviewerUserIds: [other.id] }),
    ).rejects.toMatchObject({ code: "COI" });
    await expect(
      completeTask(pick.id, leader.id, { outcome: "YES", reviewerUserIds: [staff.id] }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await completeTask(pick.id, leader.id, { outcome: "YES", reviewerUserIds: [chair.id] });
    const reviewerMember = await prisma.protocolMember.findFirstOrThrow({
      where: { protocolId: created.protocol.id, userId: chair.id },
    });
    expect(reviewerMember.role).toBe("PRIMARY_REVIEWER");
    const review = await prisma.task.findFirstOrThrow({ where: { instanceId: pickRun.id, stepKey: "review", status: "OPEN" } });
    await expect(reassignTask(review.id, staff.id, other.id, "Conflict")).rejects.toMatchObject({ code: "COI" });

    await publishGraph(leader.id, `DESK_${suffix}`, {
      startStep: "desk",
      steps: [
        { key: "desk", name: "Desk", type: "TASK", assignee: { kind: "ROLE", role: "REC_STAFF" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "desk", to: "end" }],
    });
    const deskRun = await startInstance(`DESK_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const desk = await prisma.task.findFirstOrThrow({ where: { instanceId: deskRun.id, status: "OPEN" } });
    expect(desk.assigneeUserId).toBeNull();
    await claimTask(desk.id, staff.id);
    await claimTask(desk.id, staff.id);
    await expect(claimTask(desk.id, leader.id)).rejects.toMatchObject({ code: "INVALID" });
    await prisma.workflowInstance.update({ where: { id: deskRun.id }, data: { status: "CANCELLED" } });
    await expect(completeTask(desk.id, staff.id)).rejects.toMatchObject({ code: "INVALID" });
    await prisma.task.update({ where: { id: desk.id }, data: { stepKey: "missing" } });
    await prisma.workflowInstance.update({ where: { id: deskRun.id }, data: { status: "RUNNING" } });
    await expect(completeTask(desk.id, staff.id)).rejects.toMatchObject({ code: "INVALID" });

    await publishGraph(leader.id, `SIGN_${suffix}`, {
      startStep: "sign",
      steps: [
        {
          key: "sign",
          name: "Sign",
          type: "SIGNATURE",
          assignee: { kind: "PROTOCOL_LEADER" },
          forms: [{ code: sign.code, mode: "SIGN", required: true }],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "sign", to: "end" }],
    });
    const signRun = await startInstance(`SIGN_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const signTask = await prisma.task.findFirstOrThrow({ where: { instanceId: signRun.id, status: "OPEN" } });
    await expect(completeTask(signTask.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });
    await prisma.formDefinition.update({ where: { id: sign.id }, data: { schema: { broken: true } } });
    await expect(completeTask(signTask.id, leader.id)).rejects.toMatchObject({ code: "INVALID" });
    const signVersion = await prisma.workflowVersion.findUniqueOrThrow({ where: { id: signRun.versionId } });
    const signGraph = structuredClone(signVersion.graph) as WorkflowGraph;
    const signStep = signGraph.steps.find((step) => step.key === "sign");
    if (signStep?.forms?.[0]) signStep.forms[0].code = "F-MISSING";
    await prisma.workflowVersion.update({ where: { id: signRun.versionId }, data: { graph: toJson(signGraph) } });
    await expect(completeTask(signTask.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });

    await expect(completeTask(crypto.randomUUID(), leader.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(cancelInstance(crypto.randomUUID(), leader.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reassignTask(crypto.randomUUID(), staff.id, leader.id, "Missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    const submitted = await inTx((tx) =>
      completeLeaderSubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {}),
    );
    expect(submitted.versionId).toBe(created.version.id);
    await inTx((tx) => completeLeaderSubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {}));
    const opened = await maybeStartInitial(created.protocol.id, created.version.id, leader.id);
    const reopened = await maybeStartInitial(created.protocol.id, created.version.id, leader.id);
    expect(reopened?.id).toBe(opened?.id);
    await cancelInstance(opened!.id, leader.id);

    await publishInitial(leader.id, {
      startStep: "desk",
      steps: [
        { key: "desk", name: "Desk", type: "TASK", assignee: { kind: "ROLE", role: "REC_STAFF" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "desk", to: "end" }],
    });
    const roleRun = await maybeStartInitial(created.protocol.id, created.version.id, leader.id);
    const roleTask = await prisma.task.findFirstOrThrow({ where: { instanceId: roleRun!.id, status: "OPEN" } });
    expect(roleTask.assigneeUserId).toBeNull();
    await inTx((tx) => completeLeaderSubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {}));

    await publishInitial(leader.id, {
      startStep: "theirs",
      steps: [
        { key: "theirs", name: "Theirs", type: "TASK", assignee: { kind: "USER", userId: other.id } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "theirs", to: "end" }],
    });
    await expect(
      inTx((tx) => completeLeaderSubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {})),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const finishedSubmit = await prisma.task.findFirstOrThrow({
      where: { instance: { protocolId: created.protocol.id }, stepKey: "submit", status: "COMPLETED" },
    });
    await expect(reassignTask(finishedSubmit.id, staff.id, leader.id, "Too late")).rejects.toMatchObject({
      code: "INVALID",
    });

    await publishGraph(leader.id, "RESUBMISSION", {
      startStep: "revise",
      steps: [
        { key: "revise", name: "Revise", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "revise", to: "end" }],
    });
    const reused = await inTx(async (tx) => {
      const first = await maybeStartResubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {});
      const second = await maybeStartResubmissionTx(tx, created.protocol.id, created.version.id, leader.id, {});
      return { first: first?.id, second: second?.id };
    });
    expect(reused.first).toBeTruthy();
    expect(reused.second).toBe(reused.first);
  }, 180_000);
});

function fiveStep(formCode: string): WorkflowGraph {
  return {
    startStep: "submit",
    steps: [
      {
        key: "submit",
        name: "Submit",
        type: "TASK",
        assignee: { kind: "PROTOCOL_LEADER" },
        statusLabel: "Draft",
        forms: [{ code: formCode, mode: "FILL", required: true }],
        uploads: [{ kind: "MANUSCRIPT", required: true }],
        actions: [{ kind: "SNAPSHOT_VERSION", hook: "onExit" }],
        notify: { onCompleted: "submission.received" },
      },
      {
        key: "screen",
        name: "Screen",
        type: "DECISION",
        assignee: { kind: "ROLE", role: "REC_STAFF" },
        statusLabel: "Under Screening",
        outcomes: [
          { key: "ACCEPT", label: "Accept" },
          { key: "RETURN", label: "Return" },
        ],
        assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 2, max: 2 },
        deadline: { amount: 2, unit: "WORKING_DAYS", remindBefore: [{ amount: 4, unit: "HOURS" }], escalateTo: { kind: "ROLE", role: "REC_CHAIR" } },
        notify: { onAssigned: "task.assigned", onDueSoon: "task.due", onOverdue: "task.overdue" },
      },
      {
        key: "revise",
        name: "Revise",
        type: "WAIT_PROPONENT",
        assignee: { kind: "PROTOCOL_LEADER" },
        deadline: { amount: 3, unit: "WORKING_DAYS" },
        statusLabel: "Awaiting Revision",
      },
      {
        key: "review",
        name: "Review",
        type: "PARALLEL_TASK",
        assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "screen" },
        parallel: { completeWhen: "ALL" },
        statusLabel: "Under Review",
      },
      { key: "done", name: "Done", type: "END", statusLabel: "Approved" },
    ],
    transitions: [
      { from: "submit", to: "screen" },
      { from: "screen", to: "review", when: { "==": [{ var: "outcome" }, "ACCEPT"] }, priority: 2 },
      { from: "screen", to: "revise", when: { "==": [{ var: "outcome" }, "RETURN"] }, priority: 1 },
      { from: "revise", to: "submit" },
      { from: "review", to: "done" },
    ],
  };
}
