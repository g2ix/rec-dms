import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { parseGraph } from "@/lib/workflow/graph";
import { validateGraph } from "@/lib/workflow/validate";
import { readFirstSheet } from "@/lib/xlsx";
import { parseMemberSheet } from "@/lib/panels/import";
import { prisma } from "@/server/db";
import { decisionSigner } from "@/server/docs/generate";
import { renderFormDocument } from "@/server/docs/render";
import { applyEffectiveDates, formDefinitionFor, referenceDate, workflowVersionFor } from "@/server/effective";
import { decideBill, issueBillTx } from "@/server/fees/bills";
import { saveSchedule } from "@/server/fees/schedules";
import { createDefinition, publishDefinition } from "@/server/forms/definitions";
import { toJson } from "@/server/forms/json";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { submitVersion } from "@/server/protocols/versions";
import { meetingGroups } from "@/server/reports/meetings";
import { putObject } from "@/server/storage";
import { makeUser } from "@/server/test/users";
import { applyImport, planImport } from "@/server/users/panel-import";
import { publishWorkflow } from "@/server/workflow/definitions";
import { completeTask, declareConflict, startInstance, timeoutOverdueTasks } from "@/server/workflow/engine";
import { initialSubmission, resubmission } from "../../../prisma/seed/usc-rec/workflows";

async function role(key: string, scope: "GLOBAL" | "PANEL" = "GLOBAL") {
  return prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, scope } });
}

async function grant(userId: string, key: string, panelId: string | null = null, attributes: Record<string, unknown> = {}) {
  const row = await role(key, panelId ? "PANEL" : "GLOBAL");
  await prisma.userRole.create({ data: { userId, roleId: row.id, panelId, attributes: toJson(attributes) } });
}

async function publishGraph(userId: string, key: string, graph: WorkflowGraph, effectiveFrom: Date | null = null) {
  let definition = await prisma.workflowDefinition.findUnique({ where: { key } });
  if (!definition) definition = await prisma.workflowDefinition.create({ data: { key, name: key, submissionType: "INITIAL" } });
  const max = await prisma.workflowVersion.aggregate({ where: { definitionId: definition.id }, _max: { number: true } });
  const version = await prisma.workflowVersion.create({
    data: { definitionId: definition.id, number: (max._max.number ?? 0) + 1, status: "DRAFT", graph: toJson(graph) },
  });
  return publishWorkflow(version.id, userId, effectiveFrom);
}

async function protocolFor(userId: string, title: string) {
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId } });
  return createProtocolForUser(userId, {
    title,
    researchType: "Basic",
    affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "1st year", institution: "University of San Carlos", contactEmailId: email.id },
  });
}

async function openTasks(instanceId: string, stepKey?: string) {
  return prisma.task.findMany({ where: { instanceId, status: { in: ["OPEN", "CLAIMED"] }, ...(stepKey ? { stepKey } : {}) }, orderBy: { createdAt: "asc" } });
}

/** A copy of an official template whose body is only the given text, so a test can read what was filled. */
async function tinyTemplate(userId: string, text: string): Promise<string> {
  const zip = new PizZip(readFileSync(join(process.cwd(), "templates", "F-39.docx")));
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  const bytes = zip.generate({ type: "nodebuffer" }) as Buffer;
  const key = `test/templates/${crypto.randomUUID()}.docx`;
  await putObject(key, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const file = await prisma.storedFile.create({
    data: { kind: "TEMPLATE", originalName: "t.docx", storageKey: key, mime: "application/octet-stream", size: bytes.length, sha256: "x", uploadedById: userId, scanStatus: "CLEAN" },
  });
  return file.id;
}

function documentText(bytes: Buffer): string {
  return new PizZip(bytes).file("word/document.xml")?.asText() ?? "";
}

describe("M13 engine capabilities", () => {
  it("keeps the seeded workflow graphs valid and unchanged under the new schema", () => {
    for (const graph of [initialSubmission, resubmission]) {
      const parsed = parseGraph(graph);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(JSON.parse(JSON.stringify(parsed.graph))).toEqual(JSON.parse(JSON.stringify(graph)));
      expect(validateGraph(graph)).toEqual([]);
    }
  });

  it("falls back chair → vice-chair → REC Chair on a declared conflict, and the letter names who signed", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `coi.lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const chair = await makeUser({ email: `coi.chair.${suffix}@usc.edu.ph`, familyName: "Chair" });
    const vice = await makeUser({ email: `coi.vice.${suffix}@usc.edu.ph`, familyName: "Vice" });
    const recChair = await makeUser({ email: `coi.rec.${suffix}@usc.edu.ph`, firstName: "Rosa", familyName: "Recchair" });
    const staff = await makeUser({ email: `coi.staff.${suffix}@usc.edu.ph`, familyName: "Staff" });
    const panel = await prisma.panel.create({ data: { code: `C${suffix}`, name: `Panel ${suffix}` } });
    await grant(chair.id, "PANEL_CHAIR", panel.id);
    await grant(vice.id, "PANEL_VICE_CHAIR", panel.id);
    await grant(recChair.id, "REC_CHAIR");
    await grant(staff.id, "REC_STAFF");
    const created = await protocolFor(leader.id, `Conflict ${suffix}`);
    await prisma.protocol.update({ where: { id: created.protocol.id }, data: { panelId: panel.id } });
    const graph: WorkflowGraph = {
      startStep: "decide",
      steps: [
        {
          key: "decide",
          name: "Decide",
          type: "DECISION",
          assignee: {
            kind: "FIRST_AVAILABLE",
            rules: [
              { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" },
              { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_VICE_CHAIR" },
              { kind: "ROLE", role: "REC_CHAIR" },
            ],
          },
          outcomes: [{ key: "APPROVED", label: "Approved" }],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "decide", to: "end" }],
    };
    await publishGraph(leader.id, `COI_${suffix}`, graph);
    const instance = await startInstance(`COI_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const first = (await openTasks(instance.id))[0]!;
    expect(first.assigneeUserId).toBe(chair.id);
    await expect(declareConflict(first.id, vice.id, "Not mine")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(declareConflict(first.id, chair.id, " ")).rejects.toMatchObject({ code: "INVALID" });

    await declareConflict(first.id, chair.id, "My student");
    const second = (await openTasks(instance.id))[0]!;
    expect(second.assigneeUserId).toBe(vice.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("REASSIGNED");
    await declareConflict(second.id, vice.id, "Co-author");
    const third = (await openTasks(instance.id))[0]!;
    expect(third.assigneeUserId).toBe(recChair.id);
    await expect(completeTask(third.id, chair.id, { outcome: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const done = await completeTask(third.id, recChair.id, { outcome: "APPROVED" });
    expect(done.instanceStatus).toBe("COMPLETED");

    expect(await prisma.conflictDeclaration.count({ where: { protocolId: created.protocol.id } })).toBe(2);
    const audited = await prisma.auditEvent.findMany({ where: { protocolId: created.protocol.id, action: { in: ["protocol.conflict_declared", "task.reassigned"] } } });
    expect(audited).toHaveLength(4);
    const notices = await prisma.job.findMany({ where: { kind: "NOTIFY", payload: { path: ["templateKey"], equals: "conflict.declared" } } });
    expect(notices.some((job) => JSON.stringify(job.payload).includes(staff.id))).toBe(true);

    const signer = await decisionSigner(instance.id, graph.steps);
    expect(signer).toBe(recChair.displayName);
    const letter = await createDefinition({
      code: `L${suffix.slice(0, 5).toUpperCase()}`,
      title: "Letter",
      version: "1",
      effectiveDate: "2026-11-11",
      schema: { sections: [{ id: "s", title: "S", fields: [{ id: "note", label: "Note", type: "text", fillers: ["REC_CHAIR"] }] }] },
      userId: leader.id,
    });
    await prisma.formDefinition.update({
      where: { id: letter.id },
      data: { templateFileId: await tinyTemplate(leader.id, "Signed by {chair}"), placeholderMap: { chair: "rec.chairName" } },
    });
    await publishDefinition(letter.id, leader.id);
    const copy = await prisma.formInstance.create({
      data: { formDefinitionId: letter.id, ownerType: "PROTOCOL_VERSION", ownerId: created.version.id, data: {}, status: "LOCKED" },
    });
    const rendered = await renderFormDocument({ instanceId: copy.id, format: "docx", userId: leader.id, extraBound: { "rec.chairName": signer } });
    expect(documentText(rendered.bytes)).toContain(`Signed by ${recChair.displayName}`);
  }, 120_000);

  it("assigns one reviewer per slot, re-designates a declined slot only, and deems the other accepted after 72 hours", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `slot.lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const chair = await makeUser({ email: `slot.chair.${suffix}@usc.edu.ph`, familyName: "Chair" });
    const sci = await makeUser({ email: `slot.sci.${suffix}@usc.edu.ph`, familyName: "Scientist" });
    const sci2 = await makeUser({ email: `slot.sci2.${suffix}@usc.edu.ph`, familyName: "Scientist2" });
    const non = await makeUser({ email: `slot.non.${suffix}@usc.edu.ph`, familyName: "Nonsci" });
    const panel = await prisma.panel.create({ data: { code: `S${suffix}`, name: `Panel ${suffix}` } });
    await grant(chair.id, "PANEL_CHAIR", panel.id);
    await grant(sci.id, "PANEL_MEMBER", panel.id, { isScientist: true, designation: "Scientist" });
    await grant(sci2.id, "PANEL_MEMBER", panel.id, { isScientist: true, designation: "Scientist" });
    await grant(non.id, "PANEL_MEMBER", panel.id, { isScientist: false, designation: "Non-scientist" });
    const created = await protocolFor(leader.id, `Slots ${suffix}`);
    await prisma.protocol.update({ where: { id: created.protocol.id }, data: { panelId: panel.id } });
    const formSchema = { sections: [{ id: "s", title: "S", fields: [{ id: "note", label: "Note", type: "text", fillers: ["PANEL_MEMBER", "REVIEWER"] }] }] };
    const sciForm = await createDefinition({ code: `A${suffix.slice(0, 5).toUpperCase()}`, title: "Scientist form", version: "1", effectiveDate: "2026-11-11", schema: formSchema, userId: leader.id });
    const nonForm = await createDefinition({ code: `B${suffix.slice(0, 5).toUpperCase()}`, title: "Lay form", version: "1", effectiveDate: "2026-11-11", schema: formSchema, userId: leader.id });
    await publishDefinition(sciForm.id, leader.id);
    await publishDefinition(nonForm.id, leader.id);
    const member = { roles: ["PANEL_MEMBER" as const] };
    const graph: WorkflowGraph = {
      startStep: "determine",
      steps: [
        {
          key: "determine",
          name: "Type of review",
          type: "DECISION",
          assignee: { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" },
          outcomes: [{ key: "EXPEDITED", label: "Expedited" }],
          assignReviewers: {
            slots: [
              { key: "SCIENTIST", label: "Scientist", eligible: { ...member, attributes: { isScientist: true } }, forms: [sciForm.code] },
              { key: "NON_SCIENTIST", label: "Non-scientist", eligible: { ...member, attributes: { isScientist: false } }, forms: [nonForm.code] },
            ],
          },
          capture: { noteToReviewers: true, reviewDueDate: true },
        },
        {
          key: "accept",
          name: "Accept the designation",
          type: "PARALLEL_TASK",
          assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine" },
          parallel: { completeWhen: "ALL" },
          outcomes: [
            { key: "ACCEPT", label: "Accept" },
            { key: "DECLINE", label: "Decline", requiresComment: true },
          ],
          deadline: { amount: 72, unit: "HOURS" },
          onTimeout: { outcome: "ACCEPT" },
          decline: { outcome: "DECLINE", redesignateBy: { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" } },
          notify: { onAssigned: "task.assigned" },
        },
        {
          key: "review",
          name: "Review",
          type: "PARALLEL_TASK",
          assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine" },
          parallel: { completeWhen: "ALL" },
          forms: [
            { code: sciForm.code, mode: "FILL", required: false, slot: "SCIENTIST" },
            { code: nonForm.code, mode: "FILL", required: false, slot: "NON_SCIENTIST" },
          ],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "determine", to: "accept" },
        { from: "accept", to: "review" },
        { from: "review", to: "end" },
      ],
    };
    await publishGraph(leader.id, `SLOT_${suffix}`, graph);
    const instance = await startInstance(`SLOT_${suffix}`, created.protocol.id, created.version.id, leader.id);
    const determine = (await openTasks(instance.id, "determine"))[0]!;
    await expect(
      completeTask(determine.id, chair.id, { outcome: "EXPEDITED", reviewerSlots: { SCIENTIST: non.id, NON_SCIENTIST: sci.id } }),
    ).rejects.toMatchObject({ code: "INVALID" });
    await expect(completeTask(determine.id, chair.id, { outcome: "EXPEDITED", reviewerSlots: { SCIENTIST: sci.id } })).rejects.toMatchObject({ code: "INVALID" });
    await completeTask(determine.id, chair.id, {
      outcome: "EXPEDITED",
      reviewerSlots: { SCIENTIST: sci.id, NON_SCIENTIST: non.id },
      noteToReviewers: "Look at the consent form.",
      reviewDueDate: "2026-11-25",
    });
    const stored = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(stored.assignments).toEqual({ determine: [{ userId: sci.id, slot: "SCIENTIST" }, { userId: non.id, slot: "NON_SCIENTIST" }] });
    const accepts = await openTasks(instance.id, "accept");
    expect(accepts.map((task) => [task.assigneeUserId, task.slot])).toEqual([
      [sci.id, "SCIENTIST"],
      [non.id, "NON_SCIENTIST"],
    ]);
    const assigned = await prisma.job.findFirstOrThrow({ where: { kind: "NOTIFY", payload: { path: ["taskId"], equals: accepts[0]!.id } } });
    expect(JSON.stringify(assigned.payload)).toContain("Look at the consent form.");
    expect(JSON.stringify(assigned.payload)).toContain("2026-11-25");

    const sciTask = accepts[0]!;
    const nonTask = accepts[1]!;
    await expect(completeTask(sciTask.id, sci.id, { outcome: "DECLINE" })).rejects.toMatchObject({ code: "INVALID" });
    await completeTask(sciTask.id, sci.id, { outcome: "DECLINE", comment: "I supervise the leader." });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: sciTask.id } })).status).toBe("DECLINED");
    const redesignate = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, kind: "SIDE", status: "OPEN" } });
    expect(redesignate.assigneeUserId).toBe(chair.id);
    expect(redesignate.slot).toBe("SCIENTIST");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: nonTask.id } })).status).toBe("OPEN");

    await expect(completeTask(redesignate.id, chair.id, { reviewerSlots: { SCIENTIST: non.id } })).rejects.toMatchObject({ code: "INVALID" });
    await completeTask(redesignate.id, chair.id, { reviewerSlots: { SCIENTIST: sci2.id } });
    const after = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(after.assignments).toEqual({ determine: [{ userId: sci2.id, slot: "SCIENTIST" }, { userId: non.id, slot: "NON_SCIENTIST" }] });
    const open = await openTasks(instance.id, "accept");
    expect(open.map((task) => task.assigneeUserId).sort()).toEqual([sci2.id, non.id].sort());
    expect(open.find((task) => task.assigneeUserId === non.id)?.id).toBe(nonTask.id);

    expect(await timeoutOverdueTasks(new Date())).toBe(0);
    const later = new Date(Date.now() + 73 * 60 * 60 * 1000);
    expect(await timeoutOverdueTasks(later)).toBe(2);
    const timed = await prisma.task.findUniqueOrThrow({ where: { id: nonTask.id } });
    expect(timed).toMatchObject({ status: "COMPLETED", outcome: "ACCEPT", completedById: null });
    expect(await prisma.auditEvent.count({ where: { protocolId: created.protocol.id, action: "task.timed_out" } })).toBe(2);

    const reviews = await openTasks(instance.id, "review");
    expect(reviews).toHaveLength(2);
    const forms = await prisma.formInstance.findMany({
      where: { ownerId: created.version.id, formDefinitionId: { in: [sciForm.id, nonForm.id] } },
      include: { filledByMember: true },
    });
    expect(forms.map((form) => [form.formDefinitionId, form.filledByMember?.userId]).sort()).toEqual(
      [
        [sciForm.id, sci2.id],
        [nonForm.id, non.id],
      ].sort(),
    );
  }, 120_000);

  it("reopens the frozen version for correction under the same number and freezes it again on submit", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `reopen.lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const staff = await makeUser({ email: `reopen.staff.${suffix}@usc.edu.ph`, familyName: "Staff" });
    await grant(staff.id, "REC_STAFF");
    await publishGraph(leader.id, "INITIAL_SUBMISSION", {
      startStep: "submit",
      steps: [
        { key: "submit", name: "Submit", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" }, actions: [{ kind: "SNAPSHOT_VERSION", hook: "onExit" }] },
        {
          key: "classify",
          name: "Classify",
          type: "DECISION",
          assignee: { kind: "ROLE", role: "REC_STAFF" },
          outcomes: [
            { key: "EXEMPT_RECOMMENDATIONS", label: "Exempt with recommendations" },
            { key: "EXEMPT", label: "Exempt" },
          ],
        },
        {
          key: "correct",
          name: "Correct and resubmit",
          type: "TASK",
          assignee: { kind: "PROTOCOL_LEADER" },
          statusLabel: "Correcting",
          actions: [{ kind: "REOPEN_VERSION", params: { forms: [] } }, { kind: "SNAPSHOT_VERSION", hook: "onExit" }],
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "submit", to: "classify" },
        { from: "classify", to: "correct", when: { "==": [{ var: "outcome" }, "EXEMPT_RECOMMENDATIONS"] } },
        { from: "classify", to: "end" },
        { from: "correct", to: "end" },
      ],
    });
    const created = await protocolFor(leader.id, `Reopen ${suffix}`);
    await submitVersion(created.protocol.id, leader.id);
    const frozen = await prisma.protocolVersion.findUniqueOrThrow({ where: { id: created.version.id } });
    expect(frozen.state).toBe("SUBMITTED");
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { protocolId: created.protocol.id } });
    const classify = (await openTasks(instance.id, "classify"))[0]!;
    await completeTask(classify.id, staff.id, { outcome: "EXEMPT_RECOMMENDATIONS" });
    const reopened = await prisma.protocolVersion.findUniqueOrThrow({ where: { id: created.version.id } });
    expect(reopened).toMatchObject({ state: "WORKING", number: 1, label: frozen.label });
    expect(await prisma.protocolVersion.count({ where: { protocolId: created.protocol.id } })).toBe(1);
    await prisma.storedFile.create({
      data: {
        protocolVersionId: created.version.id,
        kind: "MANUSCRIPT",
        originalName: "revised.pdf",
        storageKey: `test/${suffix}/revised.pdf`,
        mime: "application/pdf",
        size: 10,
        sha256: "y",
        uploadedById: leader.id,
        scanStatus: "CLEAN",
      },
    });
    await submitVersion(created.protocol.id, leader.id);
    const again = await prisma.protocolVersion.findUniqueOrThrow({ where: { id: created.version.id } });
    expect(again).toMatchObject({ state: "SUBMITTED", number: 1, label: frozen.label, reopenBaseline: null });
    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { protocolId: created.protocol.id, action: "protocol.version_submitted" },
      orderBy: { seq: "desc" },
    });
    expect(JSON.stringify(event.diff)).toContain("MANUSCRIPT revised.pdf");
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).status).toBe("COMPLETED");
  }, 120_000);

  it("issues codes from the token pattern, per year and in order", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    await prisma.setting.upsert({
      where: { key: "protocol.codePattern" },
      update: { value: "{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}" },
      create: { key: "protocol.codePattern", value: "{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}" },
    });
    await prisma.codeCounter.deleteMany({});
    await prisma.protocol.updateMany({ where: { code: { not: null } }, data: { code: null } });
    const cruz = await makeUser({ email: `code.cruz.${suffix}@usc.edu.ph`, familyName: "Cruz" });
    const santos = await makeUser({ email: `code.santos.${suffix}@usc.edu.ph`, familyName: "Santos" });
    const co = await makeUser({ email: `code.co.${suffix}@usc.edu.ph`, familyName: "Co" });
    await publishGraph(cruz.id, `CODE_${suffix}`, {
      startStep: "code",
      steps: [
        { key: "code", name: "Code", type: "AUTO", actions: [{ kind: "ASSIGN_PROTOCOL_CODE" }] },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "code", to: "end" }],
    });
    const one = await protocolFor(cruz.id, `One ${suffix}`);
    const two = await protocolFor(santos.id, `Two ${suffix}`);
    await prisma.protocolMember.create({ data: { protocolId: two.protocol.id, userId: co.id, role: "PROPONENT", status: "ACTIVE", rosterOrder: 2 } });
    await startInstance(`CODE_${suffix}`, one.protocol.id, one.version.id, cruz.id);
    await startInstance(`CODE_${suffix}`, two.protocol.id, two.version.id, santos.id);
    const year = new Date().toISOString().slice(0, 4);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: one.protocol.id } })).code).toBe(`${year}-001-Cruz`);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: two.protocol.id } })).code).toBe(`${year}-002-Santos et al`);
    await prisma.setting.update({ where: { key: "protocol.codePattern" }, data: { value: "R-{YYYY}-{####}" } });
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: one.protocol.id } })).code).toBe(`${year}-001-Cruz`);
    await prisma.setting.delete({ where: { key: "protocol.codePattern" } });
  }, 60_000);

  it("prices bills from the dated schedule, never blocks review, and lets only REC Staff release with a reason", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `fee.lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const chair = await makeUser({ email: `fee.chair.${suffix}@usc.edu.ph`, familyName: "Chair" });
    const staff = await makeUser({ email: `fee.staff.${suffix}@usc.edu.ph`, familyName: "Staff" });
    const reviewer = await makeUser({ email: `fee.rev.${suffix}@usc.edu.ph`, familyName: "Reviewer" });
    await grant(chair.id, "REC_CHAIR");
    await grant(staff.id, "REC_STAFF");
    await grant(reviewer.id, "PRIMARY_REVIEWER");
    for (const [key, label] of [
      ["USC_UG", "USC undergraduate"],
      ["USC_GRAD", "USC graduate"],
    ]) {
      await prisma.clientType.upsert({ where: { key: key! }, update: {}, create: { key: key!, label: label! } });
    }
    await saveSchedule({
      effectiveFrom: "2026-01-01",
      approvedRef: "Memo",
      notes: "",
      rates: [
        { clientTypeKey: "USC_UG", basis: "EXEMPT", amount: 80_000 },
        { clientTypeKey: "USC_UG", basis: "EXPEDITED", amount: 150_000 },
        { clientTypeKey: "USC_UG", basis: "FULL", amount: 200_000 },
        { clientTypeKey: "USC_GRAD", basis: "EXPEDITED", amount: 0 },
        { clientTypeKey: "USC_GRAD", basis: "FULL", amount: 0 },
      ],
      rules: [{ key: "NTH_REVIEW", label: "3rd to Nth review", percent: 50, fromRound: 3 }],
      actorUserId: staff.id,
    });
    const meta = {};
    const exempt = await protocolFor(leader.id, `Exempt ${suffix}`);
    await prisma.protocol.update({ where: { id: exempt.protocol.id }, data: { clientTypeKey: "USC_UG", reviewType: "EXEMPT" } });
    const third = await protocolFor(leader.id, `Third ${suffix}`);
    await prisma.protocol.update({ where: { id: third.protocol.id }, data: { clientTypeKey: "USC_UG", reviewType: "FULL" } });
    const v3 = await prisma.protocolVersion.create({ data: { protocolId: third.protocol.id, number: 3, label: "3" } });
    const grad = await protocolFor(leader.id, `Grad ${suffix}`);
    await prisma.protocol.update({ where: { id: grad.protocol.id }, data: { clientTypeKey: "USC_GRAD", reviewType: "FULL" } });
    const bills = await prisma.$transaction(async (tx) => [
      await issueBillTx(tx, { protocolId: exempt.protocol.id, protocolVersionId: exempt.version.id, basis: "reviewType", actorUserId: staff.id, meta }),
      await issueBillTx(tx, { protocolId: third.protocol.id, protocolVersionId: v3.id, basis: "nthReview", actorUserId: staff.id, meta }),
      await issueBillTx(tx, { protocolId: grad.protocol.id, protocolVersionId: grad.version.id, basis: "reviewType", actorUserId: staff.id, meta }),
      await issueBillTx(tx, { protocolId: third.protocol.id, protocolVersionId: third.version.id, basis: "nthReview", actorUserId: staff.id, meta }),
    ]);
    expect(bills.slice(0, 3).map((bill) => [bill?.amount, bill?.status])).toEqual([
      [80_000, "ISSUED"],
      [100_000, "ISSUED"],
      [0, "WAIVED"],
    ]);
    expect(bills[3]).toBeNull();
    await saveSchedule({
      effectiveFrom: "2030-01-01",
      approvedRef: "Later memo",
      notes: "",
      rates: [{ clientTypeKey: "USC_UG", basis: "EXEMPT", amount: 120_000 }],
      rules: [],
      actorUserId: staff.id,
    });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bills[0]!.id } })).amount).toBe(80_000);
    const firstSchedule = await prisma.feeSchedule.findFirstOrThrow({ where: { effectiveFrom: new Date("2026-01-01T00:00:00Z") } });
    await expect(
      saveSchedule({ id: firstSchedule.id, effectiveFrom: "2026-01-01", approvedRef: "", notes: "", rates: [], rules: [], actorUserId: staff.id }),
    ).rejects.toMatchObject({ code: "LOCKED" });

    const review = await protocolFor(leader.id, `Review ${suffix}`);
    await prisma.protocol.update({ where: { id: review.protocol.id }, data: { clientTypeKey: "USC_UG" } });
    await publishGraph(leader.id, `FEE_${suffix}`, {
      startStep: "classify",
      steps: [
        {
          key: "classify",
          name: "Classify",
          type: "DECISION",
          assignee: { kind: "ROLE", role: "REC_CHAIR" },
          outcomes: [{ key: "EXPEDITED", label: "Expedited" }],
          setFields: [{ path: "protocol.reviewType", from: "outcome" }],
          assignReviewers: { roles: ["PRIMARY_REVIEWER"], min: 1 },
          actions: [{ kind: "ISSUE_BILL", hook: "onExit", params: { basis: "reviewType" } }],
        },
        { key: "review", name: "Review", type: "TASK", assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "classify" } },
        {
          key: "release",
          name: "Release",
          type: "DECISION",
          assignee: { kind: "FIRST_AVAILABLE", rules: [{ kind: "ROLE", role: "REC_CHAIR" }, { kind: "ROLE", role: "REC_STAFF" }] },
          outcomes: [{ key: "APPROVED", label: "Approved" }],
          feeVerifiedOutcomes: ["APPROVED"],
          feeOverride: true,
        },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [
        { from: "classify", to: "review" },
        { from: "review", to: "release" },
        { from: "release", to: "end" },
      ],
    });
    const run = await startInstance(`FEE_${suffix}`, review.protocol.id, review.version.id, leader.id);
    const classify = (await openTasks(run.id, "classify"))[0]!;
    await completeTask(classify.id, chair.id, { outcome: "EXPEDITED", reviewerUserIds: [reviewer.id] });
    const bill = await prisma.bill.findFirstOrThrow({ where: { protocolId: review.protocol.id } });
    expect(bill).toMatchObject({ amount: 150_000, status: "ISSUED" });
    expect(await prisma.job.count({ where: { kind: "GENERATE_STATEMENT", payload: { path: ["billId"], equals: bill.id } } })).toBe(1);
    const reviewTask = (await openTasks(run.id, "review"))[0]!;
    await completeTask(reviewTask.id, reviewer.id);
    const release = (await openTasks(run.id, "release"))[0]!;
    await prisma.task.update({ where: { id: release.id }, data: { assigneeUserId: chair.id, status: "CLAIMED" } });
    await expect(completeTask(release.id, chair.id, { outcome: "APPROVED", feeOverrideReason: "Please" })).rejects.toMatchObject({ code: "INCOMPLETE" });
    await prisma.task.update({ where: { id: release.id }, data: { assigneeUserId: staff.id } });
    await expect(completeTask(release.id, staff.id, { outcome: "APPROVED" })).rejects.toMatchObject({ code: "INVALID" });
    await decideBill({ billId: bill.id, actorUserId: staff.id, decision: "PARTIAL", amountPaid: 50_000 });
    const done = await completeTask(release.id, staff.id, { outcome: "APPROVED", feeOverrideReason: "Dean's office pays the rest next week." });
    expect(done.instanceStatus).toBe("COMPLETED");
    const override = await prisma.auditEvent.findFirstOrThrow({ where: { protocolId: review.protocol.id, action: "fee.release_override" } });
    expect(override.diff).toMatchObject({ outstanding: 100_000, reason: "Dean's office pays the rest next week." });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PARTIALLY_PAID");
  }, 120_000);

  it("keeps a scheduled form or workflow version away from protocols created before its date", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const admin = await makeUser({ email: `eff.admin.${suffix}@usc.edu.ph`, familyName: "Admin" });
    const schema = { sections: [{ id: "s", title: "S", fields: [{ id: "note", label: "Note", type: "text", fillers: ["PROPONENT"] }] }] };
    const code = `E${suffix.slice(0, 5).toUpperCase()}`;
    const current = await createDefinition({ code, title: "Form", version: "09-00", effectiveDate: "2025-08-01", schema, userId: admin.id });
    await publishDefinition(current.id, admin.id);
    const next = await createDefinition({ code, title: "Form", version: "10-00", effectiveDate: "2027-01-01", schema, userId: admin.id });
    const startsOn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await publishDefinition(next.id, admin.id, startsOn);
    const earlier = await protocolFor(admin.id, `Earlier ${suffix}`);
    expect((await formDefinitionFor(prisma, code, new Date()))?.id).toBe(current.id);
    expect((await formDefinitionFor(prisma, code, await referenceDate(prisma, earlier.protocol.id)))?.id).toBe(current.id);
    const onDate = new Date(startsOn.getTime() + 60_000);
    expect((await formDefinitionFor(prisma, code, onDate))?.id).toBe(next.id);
    expect((await formDefinitionFor(prisma, code, await referenceDate(prisma, earlier.protocol.id, onDate)))?.id).toBe(current.id);

    const graph: WorkflowGraph = { startStep: "end", steps: [{ key: "end", name: "End", type: "END" }], transitions: [] };
    const v1 = await publishGraph(admin.id, `EFF_${suffix}`, graph);
    const v2 = await publishGraph(admin.id, `EFF_${suffix}`, graph, startsOn);
    expect((await prisma.workflowVersion.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("PUBLISHED");
    expect((await workflowVersionFor(prisma, `EFF_${suffix}`, new Date()))?.id).toBe(v1.id);
    expect((await workflowVersionFor(prisma, `EFF_${suffix}`, onDate))?.id).toBe(v2.id);

    expect(await applyEffectiveDates(new Date())).toMatchObject({ forms: 0, workflows: 0 });
    expect(await applyEffectiveDates(onDate)).toMatchObject({ forms: 1, workflows: 1 });
    expect(await applyEffectiveDates(onDate)).toMatchObject({ forms: 0, workflows: 0 });
    expect(await prisma.auditEvent.count({ where: { action: { in: ["form.version_effective", "workflow.version_effective"] } } })).toBe(2);
  }, 60_000);

  it("reads each panel's meeting day from the setting", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const staff = await makeUser({ email: `meet.staff.${suffix}@usc.edu.ph`, familyName: "Staff" });
    await grant(staff.id, "REC_STAFF");
    const panel = await prisma.panel.create({ data: { code: `M${suffix}`, name: `Panel ${suffix}` } });
    const graph: WorkflowGraph = {
      startStep: "meet",
      steps: [
        { key: "meet", name: "Meeting outcome", type: "TASK", assignee: { kind: "ROLE", role: "REC_STAFF" }, capture: { meetingDate: true } },
        { key: "end", name: "End", type: "END" },
      ],
      transitions: [{ from: "meet", to: "end" }],
    };
    await publishGraph(staff.id, `MEET_${suffix}`, graph);
    const created = await protocolFor(staff.id, `Meeting ${suffix}`);
    await prisma.protocol.update({ where: { id: created.protocol.id }, data: { panelId: panel.id, reviewType: "FULL" } });
    await startInstance(`MEET_${suffix}`, created.protocol.id, created.version.id, staff.id);
    const at = new Date("2026-11-02T04:00:00Z");
    const setRule = async (week: number) =>
      prisma.setting.upsert({
        where: { key: "meetings.schedule" },
        create: { key: "meetings.schedule", value: { panels: { [panel.code]: { weekday: 5, week, cutoffDays: 0 } } } },
        update: { value: { panels: { [panel.code]: { weekday: 5, week, cutoffDays: 0 } } } },
      });
    const meetingOf = async () => (await meetingGroups(staff.id, at)).find((group) => group.rows.some((row) => row.protocolId === created.protocol.id))?.meeting;
    await setRule(1);
    expect(await meetingOf()).toBe("2026-11-06");
    await setRule(3);
    expect(await meetingOf()).toBe("2026-11-20");
  }, 60_000);

  it("imports the members workbook, then finds nothing to change on the same file", async () => {
    const admin = await makeUser({ email: `import.admin.${crypto.randomUUID().slice(0, 8)}@usc.edu.ph`, familyName: "Admin" });
    await grant(admin.id, "SYSTEM_ADMIN");
    for (const key of ["PANEL_CHAIR", "PANEL_VICE_CHAIR", "PANEL_SECRETARY", "PANEL_MEMBER"]) await role(key, "PANEL");
    await prisma.userRole.updateMany({ where: { role: { key: { in: ["PANEL_CHAIR", "PANEL_VICE_CHAIR", "PANEL_SECRETARY", "PANEL_MEMBER"] } } }, data: { revokedAt: new Date() } });
    const parsed = parseMemberSheet(readFirstSheet(readFileSync(join(process.cwd(), "docs", "forms", "2026-11", "REC members.xlsx"))));
    const codes = [...new Set(parsed.rows.map((row) => row.panelCode))];
    expect(codes).toHaveLength(3);
    await prisma.panel.deleteMany({ where: { code: { in: codes }, protocols: { none: {} } } });
    await applyImport({ rows: parsed.rows, actorUserId: admin.id });
    for (const code of codes) {
      const panel = await prisma.panel.findUniqueOrThrow({ where: { code } });
      const grants = await prisma.userRole.findMany({ where: { panelId: panel.id, revokedAt: null }, include: { role: true } });
      for (const key of ["PANEL_CHAIR", "PANEL_VICE_CHAIR", "PANEL_SECRETARY"]) expect(grants.filter((row) => row.role.key === key)).toHaveLength(1);
      const flags = grants.map((row) => (row.attributes as { isScientist?: boolean | null }).isScientist);
      expect(flags).toContain(true);
      expect(flags).toContain(false);
    }
    expect((await planImport(prisma, parsed.rows)).filter((item) => item.kind !== "skip")).toEqual([]);
    const changed = parsed.rows.map((row, index) => (index === 5 ? { ...row, attributes: { ...row.attributes, designation: "Non-scientist", isScientist: false } } : row));
    const plan = await planImport(prisma, changed);
    expect(plan.filter((item) => item.kind === "change")).toHaveLength(1);
    const removed = await planImport(prisma, parsed.rows.slice(1));
    expect(removed.filter((item) => item.kind === "remove")).toHaveLength(1);
  }, 120_000);

  it("prints the chair override and leaves out redacted fields only in the copy for proponents", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `rel.lead.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const created = await protocolFor(leader.id, `Release ${suffix}`);
    const form = await createDefinition({
      code: `R${suffix.slice(0, 5).toUpperCase()}`,
      title: "Summary",
      version: "1",
      effectiveDate: "2026-11-11",
      schema: {
        sections: [
          {
            id: "s",
            title: "S",
            fields: [
              {
                id: "points",
                label: "Points",
                type: "assessmentTable",
                fillers: ["REVIEWER", "PANEL_CHAIR"],
                rows: [{ id: "r1", code: "1", label: "Aims" }],
                columns: [
                  { id: "comments", label: "Comments", type: "textarea", fillers: ["REVIEWER"] },
                  { id: "chair_comment", label: "Chair", type: "textarea", fillers: ["PANEL_CHAIR"], overrides: "comments" },
                ],
              },
              { id: "reviewer_name", label: "Reviewer", type: "text", fillers: ["REVIEWER"] },
            ],
          },
        ],
      },
      userId: leader.id,
    });
    await prisma.formDefinition.update({
      where: { id: form.id },
      data: {
        templateFileId: await tinyTemplate(leader.id, "{#points}[{comments}]{/points} by {reviewer}"),
        placeholderMap: { points: { helper: "assessmentRows", path: "points", columns: ["comments"] }, reviewer: "reviewer_name" },
      },
    });
    await publishDefinition(form.id, leader.id);
    const copy = await prisma.formInstance.create({
      data: {
        formDefinitionId: form.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: created.version.id,
        data: { points: { r1: { comments: "Reviewer words", chair_comment: "Chair words" } }, reviewer_name: "Dr. Hidden" },
        status: "LOCKED",
      },
    });
    const staffCopy = await renderFormDocument({ instanceId: copy.id, format: "docx", userId: leader.id });
    expect(documentText(staffCopy.bytes)).toContain("[Reviewer words] by Dr. Hidden");
    const sent = await renderFormDocument({
      instanceId: copy.id,
      format: "docx",
      userId: leader.id,
      variant: "release-proponent",
      audience: "PROPONENT",
      options: { showOriginal: false, redact: ["reviewer_name"] },
    });
    expect(documentText(sent.bytes)).toContain("[Chair words] by ");
    expect(documentText(sent.bytes)).not.toContain("Dr. Hidden");
    expect(documentText(sent.bytes)).not.toContain("Reviewer words");
    const stored = await prisma.formInstance.findUniqueOrThrow({ where: { id: copy.id } });
    expect(stored.data).toMatchObject({ points: { r1: { comments: "Reviewer words", chair_comment: "Chair words" } }, reviewer_name: "Dr. Hidden" });
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: sent.fileId } })).audience).toBe("PROPONENT");
  }, 60_000);
});
