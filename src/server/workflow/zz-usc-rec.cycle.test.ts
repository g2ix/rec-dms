import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { eachField, findField, validateSchema, type FormSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { canSignSlot, signatureSlots, type RosterMember } from "@/lib/signatures/target";
import { prisma } from "@/server/db";
import { createDefinition, publishDefinition } from "@/server/forms/definitions";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { startRevision } from "@/server/protocols/versions";
import { toRoster } from "@/server/signatures/sign";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";
import { createWorkflow, draftFromPublished, publishWorkflow, saveDraftGraph } from "@/server/workflow/definitions";
import { completeTask, lapseOverdueWaits } from "@/server/workflow/engine";
import { uscForms } from "../../../prisma/seed/usc-rec/forms";
import { initialSubmission, resubmission } from "../../../prisma/seed/usc-rec/workflows";

async function grant(userId: string, key: string, panelId?: string | null) {
  const role = await prisma.role.upsert({
    where: { key },
    update: {},
    create: { key, name: key, scope: panelId ? "PANEL" : "GLOBAL" },
  });
  await prisma.userRole.create({ data: { userId, roleId: role.id, panelId: panelId ?? null } });
}

async function publishForms(userId: string) {
  for (const form of uscForms) {
    const rows = await prisma.formDefinition.findMany({ where: { code: form.code, status: "PUBLISHED" } });
    if (rows.length === 0) {
      const created = await createDefinition({ ...form, userId });
      await publishDefinition(created.id, userId);
      continue;
    }
    for (const row of rows) {
      await prisma.formDefinition.update({ where: { id: row.id }, data: { schema: form.schema as never, title: form.title } });
    }
  }
}

async function publishKey(userId: string, key: string, name: string, submissionType: string, graph: WorkflowGraph) {
  const existing = await prisma.workflowDefinition.findUnique({ where: { key } });
  if (!existing) {
    const version = await createWorkflow({ key, name, submissionType, userId });
    await saveDraftGraph(version.id, graph, userId);
    await publishWorkflow(version.id, userId);
    return;
  }
  const draft = await draftFromPublished(existing.id, userId);
  await saveDraftGraph(draft.id, graph, userId);
  await publishWorkflow(draft.id, userId);
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function blank(type: string, value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (type === "yesNoNa" && typeof value === "object") {
    const choice = (value as { choice?: unknown }).choice;
    return choice !== "YES" && choice !== "NO" && choice !== "NA";
  }
  return false;
}

function sample(type: string, options?: { value: string }[]): unknown {
  if (type === "money" || type === "number") return 10000;
  if (type === "date") return "2026-11-06";
  if (type === "declaration") return true;
  if (type === "yesNoNa") return { choice: "YES", reason: "" };
  if (type === "radio" || type === "select") return options?.[0]?.value ?? "YES";
  if (type === "checkboxes") return options?.[0] ? [options[0].value] : [];
  return "Page 1, paragraph 1";
}

function canFill(fillers: string[] | undefined, steps: string[] | undefined, roles: string[], stepKey: string): boolean {
  if (steps && steps.length > 0 && !steps.includes(stepKey)) return false;
  if (fillers && fillers.length > 0 && !fillers.some((role) => roles.includes(role))) return false;
  return true;
}

function fillSchema(schema: FormSchema, current: Record<string, unknown>, stepKey: string, roles: string[], overrides: Record<string, unknown>) {
  const data = { ...current };
  for (const field of eachField(schema)) {
    if (field.type === "staticText" || field.type === "computed" || field.type === "signature" || field.bind) continue;
    if (field.type === "assessmentTable") {
      if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
      const table = record(data[field.id]);
      for (const row of field.rows ?? []) {
        const cells = record(table[row.id]);
        for (const column of field.columns ?? []) {
          if (column.type === "computed") continue;
          const steps = column.editableInSteps ?? field.editableInSteps;
          if (!canFill(column.fillers, steps, roles, stepKey)) continue;
          if (!blank(column.type, cells[column.id])) continue;
          cells[column.id] = sample(column.type, column.options);
        }
        table[row.id] = cells;
      }
      data[field.id] = table;
      continue;
    }
    if (field.type === "repeatingTable") {
      if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
      const rows = Array.isArray(data[field.id]) ? (data[field.id] as Record<string, unknown>[]) : [];
      if (rows.length > 0 || !field.validation?.required) continue;
      const row: Record<string, unknown> = {};
      for (const column of field.columns ?? []) {
        if (column.type === "computed") continue;
        row[column.id] = sample(column.type, column.options);
      }
      data[field.id] = [row];
      continue;
    }
    if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
    if (!blank(field.type, data[field.id])) continue;
    data[field.id] = sample(field.type, field.options);
  }
  return { ...data, ...overrides };
}

async function roster(protocolId: string): Promise<RosterMember[]> {
  return toRoster(
    await prisma.protocolMember.findMany({
      where: { protocolId, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { displayName: true } } },
    }),
  );
}

async function signatureIdFor(userId: string): Promise<string> {
  const existing = await prisma.signature.findFirst({ where: { userId, active: true } });
  if (existing) return existing.id;
  const created = await prisma.signature.create({
    data: { userId, imageKey: `signatures/test/${userId}.png`, method: "UPLOADED", active: true },
  });
  return created.id;
}

async function writeForm(
  versionId: string,
  code: string,
  stepKey: string,
  roles: string[],
  userId: string,
  protocolId: string,
  memberId?: string | null,
  overrides: Record<string, unknown> = {},
) {
  const instance = await prisma.formInstance.findFirst({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: versionId,
      filledByMemberId: memberId ?? null,
      formDefinition: { code, status: "PUBLISHED" },
    },
    include: { formDefinition: true },
  });
  if (!instance) throw new Error(`Form ${code} is not open on this version.`);
  const check = validateSchema(instance.formDefinition.schema);
  if (!check.ok) throw new Error(check.issues[0]?.message ?? code);
  const data = fillSchema(check.schema, record(instance.data), stepKey, roles, overrides);
  const issues = validateInstance({ schema: check.schema }, data, { roles, stepKey });
  if (issues.length > 0) {
    throw new Error(`${code}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  await prisma.$transaction(async (tx) => {
    if (instance.status === "LOCKED") await tx.$executeRaw`SELECT set_config('recdms.form_review', 'on', true)`;
    await tx.formInstance.update({ where: { id: instance.id }, data: { data: data as never } });
  });
  const members = await roster(protocolId);
  const filler = memberId ? members.find((member) => member.userId === userId) : null;
  const signatureId = await signatureIdFor(userId);
  for (const slot of signatureSlots(check.schema, members, { assigneeUserId: filler?.userId ?? null })) {
    if (!slot.required) continue;
    const field = findField(check.schema, slot.fieldId);
    if (!field?.editableInSteps?.includes(stepKey)) continue;
    if (!canSignSlot(field, slot, { userId, roles })) continue;
    await prisma.signatureEvent.create({
      data: {
        formInstanceId: instance.id,
        fieldPath: slot.fieldPath,
        userId,
        signatureId,
        dataHash: "seeded",
        protocolVersionId: versionId,
        signedAt: new Date(),
        verifyRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      },
    });
  }
}

async function file(versionId: string, userId: string, kind: "MANUSCRIPT" | "COVER_LETTER" | "FEE_RECEIPT") {
  await prisma.storedFile.create({
    data: {
      protocolVersionId: versionId,
      kind,
      originalName: `${kind.toLowerCase()}.pdf`,
      storageKey: `${kind}-${crypto.randomUUID()}`,
      mime: "application/pdf",
      size: 128,
      sha256: "abc",
      uploadedById: userId,
      scanStatus: "CLEAN",
    },
  });
}

async function running(protocolId: string) {
  return prisma.workflowInstance.findFirstOrThrow({
    where: { protocolId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
}

async function finish(instanceId: string, stepKey: string, userId: string, input: { outcome?: string; reviewerUserIds?: string[]; newDueAt?: string } = {}) {
  const task = await prisma.task.findFirstOrThrow({
    where: { instanceId, stepKey, kind: "MAIN", status: { in: ["OPEN", "CLAIMED"] }, OR: [{ assigneeUserId: userId }, { assigneeUserId: null }] },
  });
  return completeTask(task.id, userId, input);
}

describe("USC REC seeded workflows", () => {
  it("runs an expedited minor revision through resubmission to approval", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `lead.${suffix}@usc.edu.ph`, familyName: "Leader", password: STRONG_PASSWORD });
    const adviser = await makeUser({ email: `adviser.${suffix}@usc.edu.ph`, familyName: "Adviser", password: STRONG_PASSWORD });
    const staff = await makeUser({ email: `staff.${suffix}@usc.edu.ph`, familyName: "Staff", password: STRONG_PASSWORD });
    const chair = await makeUser({ email: `chair.${suffix}@usc.edu.ph`, familyName: "Chair", password: STRONG_PASSWORD });
    const primary = await makeUser({ email: `primary.${suffix}@usc.edu.ph`, familyName: "Primary", password: STRONG_PASSWORD });
    const consultant = await makeUser({ email: `consult.${suffix}@usc.edu.ph`, familyName: "Consultant", password: STRONG_PASSWORD });
    await grant(staff.id, "REC_STAFF");
    const panel = await prisma.panel.create({ data: { code: `T${suffix}`, name: "Test panel" } });
    const discipline = await prisma.discipline.create({ data: { name: `Management ${suffix}`, panelId: panel.id } });
    await grant(chair.id, "REC_CHAIR");
    await grant(primary.id, "PRIMARY_REVIEWER");
    await grant(consultant.id, "INDEPENDENT_CONSULTANT");
    await publishForms(leader.id);
    await publishKey(leader.id, "INITIAL_SUBMISSION", "Initial submission", "INITIAL", initialSubmission);
    await publishKey(leader.id, "RESUBMISSION", "Resubmission", "RESUBMISSION", resubmission);

    const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
    const created = await createProtocolForUser(leader.id, {
      title: `Expedited ${suffix}`,
      disciplineId: discipline.id,
      researchType: "Basic",
      affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
    });
    await prisma.protocolMember.create({
      data: {
        protocolId: created.protocol.id,
        userId: adviser.id,
        role: "ADVISER",
        status: "ACTIVE",
        rosterOrder: 2,
        institution: "University of San Carlos",
        designation: "Adviser",
      },
    });
    let instance = await running(created.protocol.id);
    const leaderRoles = ["PROPONENT", "PROJECT_LEADER"];
    for (const code of ["F-27", "F-28", "F-29", "F-30", "F-35", "F-36"]) {
      await writeForm(instance.protocolVersionId, code, "proponent_submit", leaderRoles, leader.id, created.protocol.id);
      if (code === "F-29") {
        await writeForm(instance.protocolVersionId, code, "proponent_submit", ["ADVISER"], adviser.id, created.protocol.id);
      }
    }
    for (const kind of ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] as const) {
      await file(instance.protocolVersionId, leader.id, kind);
    }
    await prisma.feeVerification.upsert({
      where: { protocolVersionId: instance.protocolVersionId },
      create: { protocolVersionId: instance.protocolVersionId, status: "VERIFIED", verifiedById: staff.id, verifiedAt: new Date() },
      update: { status: "VERIFIED", verifiedById: staff.id, verifiedAt: new Date() },
    });
    let result = await finish(instance.id, "proponent_submit", leader.id);
    expect(result.currentStepKeys).toEqual(["staff_screening"]);

    await writeForm(instance.protocolVersionId, "F-26", "staff_screening", ["REC_STAFF"], staff.id, created.protocol.id, null, { submission_type: "INITIAL" });
    result = await finish(instance.id, "staff_screening", staff.id, { outcome: "ACCEPT" });
    expect(result.currentStepKeys).toEqual(["determine_review"]);
    const coded = await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } });
    expect(coded.code).toMatch(/^USC-REC-\d{4}-\d{4}$/);

    await writeForm(instance.protocolVersionId, "F-31", "determine_review", ["REC_CHAIR"], chair.id, created.protocol.id, null, {
      exempt: "NO",
      review_type: "EXPEDITED",
      submission_type: "INITIAL",
      risk: "MINIMAL",
    });
    result = await finish(instance.id, "determine_review", chair.id, { outcome: "EXPEDITED", reviewerUserIds: [primary.id, consultant.id] });
    expect(result.currentStepKeys).toEqual(["reviewer_ack"]);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } })).reviewType).toBe("EXPEDITED");

    for (const reviewer of [primary, consultant]) {
      await finish(instance.id, "reviewer_ack", reviewer.id);
    }
    instance = await running(created.protocol.id);
    expect(instance.currentStepKeys).toEqual(["reviewer_assess"]);
    for (const reviewer of [primary, consultant]) {
      const member = await prisma.protocolMember.findFirstOrThrow({ where: { protocolId: created.protocol.id, userId: reviewer.id, status: "ACTIVE" } });
      const roles = [member.role];
      for (const code of ["F-35", "F-36"]) {
        await writeForm(instance.protocolVersionId, code, "reviewer_assess", roles, reviewer.id, created.protocol.id, member.id, { recommended_action: "MINOR" });
      }
      await finish(instance.id, "reviewer_assess", reviewer.id);
    }

    instance = await running(created.protocol.id);
    expect(instance.currentStepKeys).toEqual(["chair_decide"]);
    await writeForm(instance.protocolVersionId, "F-37", "chair_decide", ["REC_CHAIR"], chair.id, created.protocol.id, null, { recommended_action: "MINOR" });
    result = await finish(instance.id, "chair_decide", chair.id, { outcome: "MINOR" });
    expect(result.currentStepKeys).toEqual(["chair_sign_decision"]);
    await writeForm(instance.protocolVersionId, "F-39", "chair_sign_decision", ["REC_CHAIR"], chair.id, created.protocol.id, null, { decision: "MINOR" });
    result = await finish(instance.id, "chair_sign_decision", chair.id);
    expect(result.currentStepKeys).toEqual(["staff_release"]);
    result = await finish(instance.id, "staff_release", staff.id);
    expect(result.currentStepKeys).toEqual(["await_revision"]);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } })).status).toBe("Awaiting Revision");

    await file(instance.protocolVersionId, leader.id, "MANUSCRIPT");
    const revised = await startRevision(created.protocol.id, leader.id);
    instance = await running(created.protocol.id);
    expect(instance.protocolVersionId).toBe(revised.id);
    expect(instance.parentInstanceId).toBeTruthy();
    for (const code of ["F-38", "F-35", "F-36"]) {
      await writeForm(instance.protocolVersionId, code, "proponent_revise", leaderRoles, leader.id, created.protocol.id);
    }
    await file(instance.protocolVersionId, leader.id, "MANUSCRIPT");
    result = await finish(instance.id, "proponent_revise", leader.id);
    expect(result.currentStepKeys).toEqual(["adviser_review"]);
    await writeForm(instance.protocolVersionId, "F-38", "adviser_review", ["ADVISER"], adviser.id, created.protocol.id);
    result = await finish(instance.id, "adviser_review", adviser.id);
    expect(result.currentStepKeys).toEqual(["staff_screening"]);
    await writeForm(instance.protocolVersionId, "F-26", "staff_screening", ["REC_STAFF"], staff.id, created.protocol.id, null, { submission_type: "RESUBMISSION" });
    result = await finish(instance.id, "staff_screening", staff.id, { outcome: "ACCEPT" });
    expect(result.currentStepKeys).toEqual(["reviewer_assess"]);

    for (const reviewer of [primary, consultant]) {
      await writeForm(instance.protocolVersionId, "F-38", "reviewer_assess", ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"], reviewer.id, created.protocol.id);
      await finish(instance.id, "reviewer_assess", reviewer.id);
    }
    instance = await running(created.protocol.id);
    expect(instance.currentStepKeys).toEqual(["chair_decide"]);
    await writeForm(instance.protocolVersionId, "F-38", "chair_decide", ["REC_CHAIR"], chair.id, created.protocol.id, null, { recommended_action: "APPROVED" });
    result = await finish(instance.id, "chair_decide", chair.id, { outcome: "APPROVED" });
    expect(result.currentStepKeys).toEqual(["chair_sign_decision"]);
    await writeForm(instance.protocolVersionId, "F-39", "chair_sign_decision", ["REC_CHAIR"], chair.id, created.protocol.id, null, { decision: "APPROVED" });
    await finish(instance.id, "chair_sign_decision", chair.id);
    await finish(instance.id, "staff_release", staff.id);
    result = await finish((await running(created.protocol.id)).id, "proponent_conform", leader.id);
    expect(result.instanceStatus).toBe("COMPLETED");
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } })).status).toBe("Approved");
  }, 240_000);

  it("lapses a revision when the working-day deadline passes", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `lapse.${suffix}@usc.edu.ph`, familyName: "Lapse", password: STRONG_PASSWORD });
    const adviser = await makeUser({ email: `lapse.adviser.${suffix}@usc.edu.ph`, familyName: "Adviser", password: STRONG_PASSWORD });
    const staff = await makeUser({ email: `lapse.staff.${suffix}@usc.edu.ph`, familyName: "Staff", password: STRONG_PASSWORD });
    const chair = await makeUser({ email: `lapse.chair.${suffix}@usc.edu.ph`, familyName: "Chair", password: STRONG_PASSWORD });
    const primary = await makeUser({ email: `lapse.primary.${suffix}@usc.edu.ph`, familyName: "Primary", password: STRONG_PASSWORD });
    const consultant = await makeUser({ email: `lapse.consult.${suffix}@usc.edu.ph`, familyName: "Consultant", password: STRONG_PASSWORD });
    await grant(staff.id, "REC_STAFF");
    await grant(primary.id, "PRIMARY_REVIEWER");
    await grant(consultant.id, "INDEPENDENT_CONSULTANT");
    const panel = await prisma.panel.create({ data: { code: `L${suffix}`, name: "Lapse panel" } });
    await grant(chair.id, "REC_CHAIR");
    const discipline = await prisma.discipline.create({ data: { name: `Law ${suffix}`, panelId: panel.id } });
    const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
    const created = await createProtocolForUser(leader.id, {
      title: `Lapse ${suffix}`,
      disciplineId: discipline.id,
      researchType: "Basic",
      affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
    });
    await prisma.protocolMember.create({
      data: { protocolId: created.protocol.id, userId: adviser.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 2, institution: "University of San Carlos", designation: "Adviser" },
    });
    let instance = await running(created.protocol.id);
    for (const code of ["F-27", "F-28", "F-29", "F-30", "F-35", "F-36"]) {
      await writeForm(instance.protocolVersionId, code, "proponent_submit", ["PROPONENT", "PROJECT_LEADER"], leader.id, created.protocol.id);
      if (code === "F-29") await writeForm(instance.protocolVersionId, code, "proponent_submit", ["ADVISER"], adviser.id, created.protocol.id);
    }
    for (const kind of ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] as const) await file(instance.protocolVersionId, leader.id, kind);
    await prisma.feeVerification.upsert({
      where: { protocolVersionId: instance.protocolVersionId },
      create: { protocolVersionId: instance.protocolVersionId, status: "VERIFIED", verifiedById: staff.id, verifiedAt: new Date() },
      update: { status: "VERIFIED" },
    });
    await finish(instance.id, "proponent_submit", leader.id);
    await writeForm(instance.protocolVersionId, "F-26", "staff_screening", ["REC_STAFF"], staff.id, created.protocol.id);
    await finish(instance.id, "staff_screening", staff.id, { outcome: "ACCEPT" });
    await writeForm(instance.protocolVersionId, "F-31", "determine_review", ["REC_CHAIR"], chair.id, created.protocol.id, null, {
      exempt: "NO",
      review_type: "EXPEDITED",
    });
    await finish(instance.id, "determine_review", chair.id, { outcome: "EXPEDITED", reviewerUserIds: [primary.id, consultant.id] });
    for (const reviewer of [primary, consultant]) await finish(instance.id, "reviewer_ack", reviewer.id);
    instance = await running(created.protocol.id);
    for (const reviewer of [primary, consultant]) {
      const member = await prisma.protocolMember.findFirstOrThrow({ where: { protocolId: created.protocol.id, userId: reviewer.id } });
      for (const code of ["F-35", "F-36"]) {
        await writeForm(instance.protocolVersionId, code, "reviewer_assess", [member.role], reviewer.id, created.protocol.id, member.id);
      }
      await finish(instance.id, "reviewer_assess", reviewer.id);
    }
    instance = await running(created.protocol.id);
    await writeForm(instance.protocolVersionId, "F-37", "chair_decide", ["REC_CHAIR"], chair.id, created.protocol.id, null, { recommended_action: "MINOR" });
    await finish(instance.id, "chair_decide", chair.id, { outcome: "MINOR" });
    await writeForm(instance.protocolVersionId, "F-39", "chair_sign_decision", ["REC_CHAIR"], chair.id, created.protocol.id, null, { decision: "MINOR" });
    await finish(instance.id, "chair_sign_decision", chair.id);
    await finish(instance.id, "staff_release", staff.id);
    const wait = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, stepKey: "await_revision", kind: "MAIN" } });
    await prisma.task.update({ where: { id: wait.id }, data: { dueAt: new Date("2020-01-01T00:00:00.000Z") } });
    expect(await lapseOverdueWaits()).toBeGreaterThan(0);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: created.protocol.id } })).status).toBe("Lapsed");
  }, 240_000);

  it("sends determine review to the Panel Chair after that assignee is published", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `v2.${suffix}@usc.edu.ph`, familyName: "Leader", password: STRONG_PASSWORD });
    const adviser = await makeUser({ email: `v2.adviser.${suffix}@usc.edu.ph`, familyName: "Adviser", password: STRONG_PASSWORD });
    const staff = await makeUser({ email: `v2.staff.${suffix}@usc.edu.ph`, familyName: "Staff", password: STRONG_PASSWORD });
    const panelChair = await makeUser({ email: `v2.panel.${suffix}@usc.edu.ph`, familyName: "PanelChair", password: STRONG_PASSWORD });
    await grant(staff.id, "REC_STAFF");
    const panel = await prisma.panel.create({ data: { code: `V${suffix}`, name: "Version panel" } });
    await grant(panelChair.id, "PANEL_CHAIR", panel.id);
    const graph = structuredClone(initialSubmission);
    const step = graph.steps.find((item) => item.key === "determine_review");
    if (!step) throw new Error("determine_review is missing");
    step.assignee = { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" };
    const definition = await prisma.workflowDefinition.findUniqueOrThrow({ where: { key: "INITIAL_SUBMISSION" } });
    const draft = await draftFromPublished(definition.id, leader.id);
    await saveDraftGraph(draft.id, graph, leader.id);
    await publishWorkflow(draft.id, leader.id);

    const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
    const created = await createProtocolForUser(leader.id, {
      title: `Chair change ${suffix}`,
      disciplineId: (await prisma.discipline.create({ data: { name: `Accountancy ${suffix}`, panelId: panel.id } })).id,
      researchType: "Basic",
      affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
    });
    await prisma.protocolMember.create({
      data: { protocolId: created.protocol.id, userId: adviser.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 2, institution: "University of San Carlos", designation: "Adviser" },
    });
    const instance = await running(created.protocol.id);
    for (const code of ["F-27", "F-28", "F-29", "F-30", "F-35", "F-36"]) {
      await writeForm(instance.protocolVersionId, code, "proponent_submit", ["PROPONENT", "PROJECT_LEADER"], leader.id, created.protocol.id);
      if (code === "F-29") await writeForm(instance.protocolVersionId, code, "proponent_submit", ["ADVISER"], adviser.id, created.protocol.id);
    }
    for (const kind of ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] as const) await file(instance.protocolVersionId, leader.id, kind);
    await prisma.feeVerification.upsert({
      where: { protocolVersionId: instance.protocolVersionId },
      create: { protocolVersionId: instance.protocolVersionId, status: "VERIFIED", verifiedById: staff.id, verifiedAt: new Date() },
      update: { status: "VERIFIED" },
    });
    await finish(instance.id, "proponent_submit", leader.id);
    await writeForm(instance.protocolVersionId, "F-26", "staff_screening", ["REC_STAFF"], staff.id, created.protocol.id);
    const result = await finish(instance.id, "staff_screening", staff.id, { outcome: "ACCEPT" });
    expect(result.currentStepKeys).toEqual(["determine_review"]);
    const task = await prisma.task.findFirstOrThrow({ where: { instanceId: instance.id, stepKey: "determine_review", status: "OPEN" } });
    expect(task.assigneeUserId === panelChair.id || task.assigneeUserId == null).toBe(true);
    if (task.assigneeUserId == null) {
      const rule = task.candidateRule as { role?: string } | null;
      expect(rule?.role).toBe("PANEL_CHAIR");
    }
  }, 240_000);
});
