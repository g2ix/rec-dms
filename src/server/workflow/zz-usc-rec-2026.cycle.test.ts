import PizZip from "pizzip";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { manilaDay } from "@/lib/workflow/calendar";
import { prisma } from "@/server/db";
import { generateDecisionDocuments } from "@/server/docs/generate";
import { decideBill } from "@/server/fees/bills";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { startRevision } from "@/server/protocols/versions";
import { getObjectBytes } from "@/server/storage";
import { finish, formOn, grant, openTask, running, sign, upload, writeForm } from "@/server/test/usc-cycle";
import { makeUser } from "@/server/test/users";
import { declareConflict, startInstance, timeoutOverdueTasks } from "@/server/workflow/engine";
import { FEE_RULES, installProcess2026, memoRates } from "../../../prisma/seed/usc-rec/install-2026-11";
import { PROCESS_START } from "../../../prisma/seed/usc-rec/workflows-2026-11";

// The release copies are what these tests check, not PDF conversion.
vi.mock("@/server/docs/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/docs/pdf")>()),
  convertDocxToPdf: async () => new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n")),
}));

const LEADER = ["PROPONENT", "PROJECT_LEADER"];
const STAFF = ["REC_STAFF"];
const REVIEWER = ["REVIEWER"];
/** A protocol created on the first working day of the new process. */
const CREATED_ON = new Date(PROCESS_START.getTime() + 3 * 24 * 60 * 60 * 1000);

type People = Awaited<ReturnType<typeof people>>;

async function people(suffix: string) {
  const make = (key: string, familyName: string) => makeUser({ email: `n26.${key}.${suffix}@usc.edu.ph`, firstName: key, familyName });
  const all = {
    leader: await make("leader", "Cruz"),
    staff: await make("staff", "Staff"),
    chair: await make("chair", "Chair"),
    vice: await make("vice", "Vicechair"),
    secretary: await make("secretary", "Secretary"),
    scientist: await make("scientist", "Scientist"),
    layperson: await make("layperson", "Layperson"),
  };
  const panel = await prisma.panel.create({ data: { code: `N${suffix}`, name: `Panel ${suffix}` } });
  await grant(all.staff.id, "REC_STAFF");
  await grant(all.chair.id, "PANEL_CHAIR", panel.id, { isScientist: true, designation: "Chair" });
  await grant(all.vice.id, "PANEL_VICE_CHAIR", panel.id, { isScientist: true, designation: "Vice-Chair" });
  await grant(all.secretary.id, "PANEL_SECRETARY", panel.id, { isScientist: false, designation: "Secretary" });
  await grant(all.scientist.id, "PANEL_MEMBER", panel.id, { isScientist: true, designation: "Scientist" });
  await grant(all.layperson.id, "PANEL_MEMBER", panel.id, { isScientist: false, designation: "Non-scientist" });
  return { ...all, panel };
}

/**
 * A protocol created after the start date runs on the November 2026 versions. The protocol is
 * created now and dated on the start date, the way it will be created then.
 */
async function newProtocol(who: People, title: string) {
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: who.leader.id } });
  const created = await createProtocolForUser(who.leader.id, {
    title,
    researchType: "Basic",
    affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
  });
  const protocolId = created.protocol.id;
  const versionId = created.version.id;
  await prisma.$transaction(async (tx) => {
    const started = await tx.workflowInstance.findMany({ where: { protocolId }, select: { id: true } });
    await tx.task.updateMany({ where: { instanceId: { in: started.map((row) => row.id) } }, data: { status: "CANCELLED" } });
    await tx.workflowInstance.updateMany({ where: { protocolId }, data: { status: "CANCELLED" } });
    await tx.formInstance.deleteMany({ where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId } });
    await tx.protocol.update({ where: { id: protocolId }, data: { createdAt: CREATED_ON, panelId: who.panel.id, clientTypeKey: "USC_SHS_UNDERGRADUATE" } });
  });
  const instance = await startInstance("INITIAL_SUBMISSION", protocolId, versionId, who.leader.id);
  const version = await prisma.workflowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
  expect(version.effectiveFrom?.getTime()).toBe(PROCESS_START.getTime());
  return { protocolId, versionId, instanceId: instance.id };
}

async function submitAndScreen(who: People, run: { protocolId: string; versionId: string; instanceId: string }) {
  for (const code of ["F-27", "F-28", "F-30", "F-35", "F-36"]) {
    await writeForm({ ...run, code, stepKey: "proponent_submit", roles: LEADER, userId: who.leader.id });
  }
  await upload(run.versionId, who.leader.id, "MANUSCRIPT");
  await upload(run.versionId, who.leader.id, "COVER_LETTER");
  expect((await finish(run.instanceId, "proponent_submit", who.leader.id)).currentStepKeys).toEqual(["staff_screening"]);
  await writeForm({ ...run, code: "F-26", stepKey: "staff_screening", roles: STAFF, userId: who.staff.id, overrides: { submission_type: "INITIAL" } });
  expect((await finish(run.instanceId, "staff_screening", who.staff.id, { outcome: "ACCEPT" })).currentStepKeys).toEqual(["determine_review"]);
}

async function determine(who: People, run: { protocolId: string; versionId: string; instanceId: string }, chair: { id: string }, roles: string[], outcome: "EXPEDITED" | "FULL") {
  await writeForm({ ...run, code: "F-31", stepKey: "determine_review", roles, userId: chair.id, overrides: { exempt: "NO", review_type: outcome, submission_type: "INITIAL" } });
  const result = await finish(run.instanceId, "determine_review", chair.id, {
    outcome,
    reviewerSlots: { SCIENTIST: who.scientist.id, NON_SCIENTIST: who.layperson.id },
    noteToReviewers: "Look closely at the consent procedure.",
    reviewDueDate: "2027-01-20",
  });
  expect(result.currentStepKeys).toEqual(["reviewer_accept"]);
  const bill = await prisma.bill.findFirstOrThrow({ where: { protocolId: run.protocolId, round: 1 } });
  expect(bill).toMatchObject({ amount: outcome === "FULL" ? 200_000 : 160_000, status: "ISSUED" });
  return bill;
}

async function memberOf(protocolId: string, userId: string) {
  return prisma.protocolMember.findFirstOrThrow({ where: { protocolId, userId, status: "ACTIVE" } });
}

/** Both reviewers accept and assess. The scientist fills F-35 and the non-scientist F-36 only. */
async function review(who: People, run: { protocolId: string; versionId: string; instanceId: string }, action: string) {
  await finish(run.instanceId, "reviewer_accept", who.scientist.id, { outcome: "ACCEPT" });
  // The non-scientist does nothing: the designation is deemed accepted after 72 hours.
  expect(await timeoutOverdueTasks(new Date(Date.now() + 73 * 60 * 60 * 1000))).toBeGreaterThanOrEqual(1);
  expect((await running(run.protocolId)).currentStepKeys).toEqual(["reviewer_assess"]);
  const scientist = await memberOf(run.protocolId, who.scientist.id);
  const layperson = await memberOf(run.protocolId, who.layperson.id);
  await expect(formOn(run.versionId, "F-36", scientist.id)).rejects.toThrow();
  await expect(formOn(run.versionId, "F-35", layperson.id)).rejects.toThrow();
  const overrides = { recommended_action: action, reviewer_name: "Printed Name" };
  await writeForm({ ...run, code: "F-35", stepKey: "reviewer_assess", roles: REVIEWER, userId: who.scientist.id, memberId: scientist.id, overrides });
  await finish(run.instanceId, "reviewer_assess", who.scientist.id);
  await writeForm({ ...run, code: "F-36", stepKey: "reviewer_assess", roles: REVIEWER, userId: who.layperson.id, memberId: layperson.id, overrides });
  return finish(run.instanceId, "reviewer_assess", who.layperson.id);
}

async function runDocumentJobs(instanceId: string) {
  const jobs = await prisma.job.findMany({ where: { kind: "GENERATE_DOCUMENTS", doneAt: null, payload: { path: ["instanceId"], equals: instanceId } } });
  for (const job of jobs) {
    await generateDecisionDocuments(job.payload);
    await prisma.job.update({ where: { id: job.id }, data: { doneAt: new Date() } });
  }
  expect(jobs.length).toBeGreaterThan(0);
}

async function released(versionId: string) {
  const files = await prisma.storedFile.findMany({
    where: { protocolVersionId: versionId, kind: "GENERATED_DOCX", audience: { not: null } },
    include: { formInstance: { include: { formDefinition: { select: { code: true } } } } },
  });
  return files.map((file) => ({ code: file.formInstance?.formDefinition.code ?? "", audience: file.audience, variant: file.variant, storageKey: file.storageKey }));
}

async function docxText(storageKey: string): Promise<string> {
  const object = await getObjectBytes(storageKey);
  return (new PizZip(Buffer.from(object.body)).file("word/document.xml")?.asText() ?? "").replace(/<[^>]+>/g, "");
}

/** Chair endorses F-37 and signs F-39; staff then prepare F-40 and the chair signs it when approved. */
async function signDecision(run: { protocolId: string; versionId: string; instanceId: string }, signer: { id: string }, roles: string[], decision: string) {
  await writeForm({ ...run, code: "F-37", stepKey: "chair_sign_decision", roles, userId: signer.id });
  await writeForm({ ...run, code: "F-39", stepKey: "chair_sign_decision", roles, userId: signer.id, overrides: { decision } });
  return finish(run.instanceId, "chair_sign_decision", signer.id);
}

async function approveAndRelease(who: People, run: { protocolId: string; versionId: string; instanceId: string }, signer: { id: string }, roles: string[], billId: string) {
  await writeForm({ ...run, code: "F-40", stepKey: "staff_prepare_certificate", roles: STAFF, userId: who.staff.id });
  await finish(run.instanceId, "staff_prepare_certificate", who.staff.id);
  await writeForm({ ...run, code: "F-40", stepKey: "chair_sign_certificate", roles, userId: signer.id });
  expect((await finish(run.instanceId, "chair_sign_certificate", signer.id)).currentStepKeys).toEqual(["staff_release"]);
  // Release waits for the bill; the review did not. REC Staff may release unpaid only with a reason.
  await expect(finish(run.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).rejects.toMatchObject({ code: "INVALID" });
  await decideBill({ billId, actorUserId: who.staff.id, decision: "VERIFIED" });
  expect((await finish(run.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["proponent_conform"]);
  await runDocumentJobs(run.instanceId);
  const files = await released(run.versionId);
  expect(files.filter((file) => file.code === "F-40").map((file) => file.audience)).toContain("PROPONENT");
  expect(files.filter((file) => file.code === "F-39").map((file) => file.audience)).toEqual(["STAFF"]);
  // Every researcher signs the Conformé before staff file it.
  await writeForm({ ...run, code: "F-40", stepKey: "proponent_conform", roles: LEADER, userId: who.leader.id });
  await finish(run.instanceId, "proponent_conform", who.leader.id);
  const done = await finish(run.instanceId, "staff_file", who.staff.id);
  expect(done.instanceStatus).toBe("COMPLETED");
  expect((await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } })).status).toBe("Approved");
  return files;
}

describe("USC REC November 2026 workflows", () => {
  let fixtureScheduleId = "";

  beforeAll(async () => {
    const owner = await makeUser({ email: `n26.owner.${crypto.randomUUID().slice(0, 8)}@usc.edu.ph`, familyName: "Owner" });
    await installProcess2026(prisma as unknown as PrismaClient, owner.id);
    // Other tests add their own schedules to this database. A copy of the memo schedule dated
    // today is the one in effect while these tests run, and is removed after them.
    const fixture = await prisma.feeSchedule.create({
      data: {
        effectiveFrom: new Date(`${manilaDay(new Date())}T00:00:00.000Z`),
        approvedRef: "M14 cycle test copy of the memo schedule",
        rates: { create: memoRates() },
        rules: { create: FEE_RULES },
      },
    });
    fixtureScheduleId = fixture.id;
  }, 600_000);

  afterAll(async () => {
    if (!fixtureScheduleId) return;
    await prisma.bill.deleteMany({ where: { scheduleId: fixtureScheduleId } });
    await prisma.feeSchedule.delete({ where: { id: fixtureScheduleId } });
  });

  it("exempts with recommendations on the same version, and issues F-42 only after payment", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Exempt ${crypto.randomUUID().slice(0, 6)}`);
    await submitAndScreen(who, run);
    const label = (await prisma.protocolVersion.findUniqueOrThrow({ where: { id: run.versionId } })).label;
    const chairRoles = ["PANEL_CHAIR"];
    await writeForm({ ...run, code: "F-31", stepKey: "determine_review", roles: chairRoles, userId: who.chair.id, overrides: { exempt: "YES", submission_type: "INITIAL" } });
    await writeForm({ ...run, code: "F-41", stepKey: "determine_review", roles: chairRoles, userId: who.chair.id, overrides: { recommended_action: "QUALIFIED", summary: "1. Add the data retention period." } });
    let result = await finish(run.instanceId, "determine_review", who.chair.id, { outcome: "EXEMPT_RECOMMENDATIONS" });
    expect(result.currentStepKeys).toEqual(["exempt_revise"]);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } })).reviewType).toBe("EXEMPT");
    expect(await prisma.bill.count({ where: { protocolId: run.protocolId } })).toBe(0);
    expect(await prisma.protocolVersion.findUniqueOrThrow({ where: { id: run.versionId } })).toMatchObject({ state: "WORKING", number: 1 });

    await upload(run.versionId, who.leader.id, "MANUSCRIPT");
    result = await finish(run.instanceId, "exempt_revise", who.leader.id);
    expect(result.currentStepKeys).toEqual(["exemption_recheck"]);
    expect(await prisma.protocolVersion.findUniqueOrThrow({ where: { id: run.versionId } })).toMatchObject({ state: "SUBMITTED", number: 1, label });
    expect(await prisma.protocolVersion.count({ where: { protocolId: run.protocolId } })).toBe(1);

    await writeForm({ ...run, code: "F-41", stepKey: "exemption_recheck", roles: chairRoles, userId: who.chair.id, overrides: { recommended_action: "QUALIFIED" } });
    result = await finish(run.instanceId, "exemption_recheck", who.chair.id, { outcome: "QUALIFIED" });
    expect(result.currentStepKeys).toEqual(["exempt_payment"]);
    const bill = await prisma.bill.findFirstOrThrow({ where: { protocolId: run.protocolId } });
    expect(bill).toMatchObject({ amount: 80_000, status: "ISSUED", round: 1 });

    await writeForm({ ...run, code: "F-42", stepKey: "exempt_payment", roles: STAFF, userId: who.staff.id, overrides: { panel_number: "1" } });
    await expect(finish(run.instanceId, "exempt_payment", who.staff.id, { outcome: "VERIFIED" })).rejects.toMatchObject({ code: "INVALID" });
    const f42 = await formOn(run.versionId, "F-42");
    expect(await prisma.signatureEvent.count({ where: { formInstanceId: f42.id } })).toBe(0);
    await decideBill({ billId: bill.id, actorUserId: who.staff.id, decision: "VERIFIED" });
    expect((await finish(run.instanceId, "exempt_payment", who.staff.id, { outcome: "VERIFIED" })).currentStepKeys).toEqual(["exempt_sign"]);

    await writeForm({ ...run, code: "F-42", stepKey: "exempt_sign", roles: chairRoles, userId: who.chair.id });
    expect((await prisma.signatureEvent.findFirstOrThrow({ where: { formInstanceId: f42.id } })).userId).toBe(who.chair.id);
    await finish(run.instanceId, "exempt_sign", who.chair.id);
    result = await finish(run.instanceId, "staff_release_exempt", who.staff.id);
    expect(result.instanceStatus).toBe("COMPLETED");
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } })).status).toBe("Exempted");
    await runDocumentJobs(run.instanceId);
    const files = await released(run.versionId);
    expect(files.filter((file) => file.code === "F-42").map((file) => file.audience)).toContain("PROPONENT");
    expect(files.filter((file) => file.code === "F-41").map((file) => file.audience)).toEqual(["STAFF"]);
  }, 600_000);

  it("approves an expedited review, sends F-40 and keeps F-39", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Expedited ${crypto.randomUUID().slice(0, 6)}`);
    await submitAndScreen(who, run);
    const bill = await determine(who, run, who.chair, ["PANEL_CHAIR"], "EXPEDITED");
    expect((await review(who, run, "APPROVED")).currentStepKeys).toEqual(["chair_review"]);
    expect((await openTask(run.instanceId, "chair_review")).assigneeUserId).toBe(who.chair.id);
    const summary = await formOn(run.versionId, "F-37");
    const praf = (summary.data as { praf?: Record<string, { comments?: string }> }).praf ?? {};
    expect(Object.keys(praf).length).toBeGreaterThan(30);
    await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: ["PANEL_CHAIR"], userId: who.chair.id, overrides: { recommended_action: "APPROVED", icf_action: "APPROVED" } });
    expect((await finish(run.instanceId, "chair_review", who.chair.id, { outcome: "APPROVED" })).currentStepKeys).toEqual(["staff_sign_summary"]);
    await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: who.staff.id });
    expect((await finish(run.instanceId, "staff_sign_summary", who.staff.id)).currentStepKeys).toEqual(["chair_sign_decision"]);
    expect((await signDecision(run, who.chair, ["PANEL_CHAIR"], "APPROVED")).currentStepKeys).toEqual(["staff_prepare_certificate"]);
    await approveAndRelease(who, run, who.chair, ["PANEL_CHAIR"], bill.id);
  }, 600_000);

  it("sends an expedited protocol the chair would disapprove to the full-review meeting", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Escalated ${crypto.randomUUID().slice(0, 6)}`);
    await submitAndScreen(who, run);
    const bill = await determine(who, run, who.chair, ["PANEL_CHAIR"], "EXPEDITED");
    await review(who, run, "DISAPPROVED");
    await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: ["PANEL_CHAIR"], userId: who.chair.id, overrides: { recommended_action: "DISAPPROVED", icf_action: "DISAPPROVED" } });
    expect((await finish(run.instanceId, "chair_review", who.chair.id, { outcome: "DISAPPROVED" })).currentStepKeys).toEqual(["meeting_outcome"]);
    expect((await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } })).reviewType).toBe("FULL");
    await expect(finish(run.instanceId, "meeting_outcome", who.staff.id, { outcome: "MINOR" })).rejects.toMatchObject({ code: "INVALID" });
    expect((await finish(run.instanceId, "meeting_outcome", who.staff.id, { outcome: "MINOR", meetingDate: "2027-02-05" })).currentStepKeys).toEqual(["staff_sign_summary"]);
    await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: who.staff.id });
    expect((await finish(run.instanceId, "staff_sign_summary", who.staff.id)).currentStepKeys).toEqual(["secretary_sign_summary"]);
    await writeForm({ ...run, code: "F-37", stepKey: "secretary_sign_summary", roles: ["PANEL_SECRETARY"], userId: who.secretary.id });
    expect((await finish(run.instanceId, "secretary_sign_summary", who.secretary.id)).currentStepKeys).toEqual(["chair_sign_decision"]);
    expect((await formOn(run.versionId, "F-39")).data).toMatchObject({ decision: "MINOR" });
    expect((await signDecision(run, who.chair, ["PANEL_CHAIR"], "MINOR")).currentStepKeys).toEqual(["staff_release"]);
    await decideBill({ billId: bill.id, actorUserId: who.staff.id, decision: "VERIFIED" });
    expect((await finish(run.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["await_revision"]);
    await runDocumentJobs(run.instanceId);
    const files = await released(run.versionId);
    expect(files.filter((file) => file.code === "F-39").map((file) => file.audience)).toEqual(["PROPONENT"]);
    expect(files.filter((file) => file.code === "F-37").map((file) => file.audience).sort()).toEqual(["PROPONENT", "STAFF"]);
    expect(files.some((file) => file.code === "F-40")).toBe(false);
  }, 600_000);

  it("moves a full review to the Vice-Chair on the Panel Chair's conflict, and the Vice-Chair signs F-39", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Conflict ${crypto.randomUUID().slice(0, 6)}`);
    await submitAndScreen(who, run);
    const task = await openTask(run.instanceId, "determine_review");
    expect(task.assigneeUserId).toBe(who.chair.id);
    await declareConflict(task.id, who.chair.id, "The project leader is my thesis advisee.");
    expect((await openTask(run.instanceId, "determine_review")).assigneeUserId).toBe(who.vice.id);
    const viceRoles = ["PANEL_VICE_CHAIR"];
    const bill = await determine(who, run, who.vice, viceRoles, "FULL");
    await review(who, run, "APPROVED");
    expect((await openTask(run.instanceId, "chair_review")).assigneeUserId).toBe(who.vice.id);
    await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: viceRoles, userId: who.vice.id, overrides: { recommended_action: "APPROVED", icf_action: "APPROVED" } });
    expect((await finish(run.instanceId, "chair_review", who.vice.id, { outcome: "APPROVED" })).currentStepKeys).toEqual(["meeting_outcome"]);
    await finish(run.instanceId, "meeting_outcome", who.staff.id, { outcome: "APPROVED", meetingDate: "2027-02-05" });
    await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: who.staff.id });
    await finish(run.instanceId, "staff_sign_summary", who.staff.id);
    await writeForm({ ...run, code: "F-37", stepKey: "secretary_sign_summary", roles: ["PANEL_SECRETARY"], userId: who.secretary.id });
    await finish(run.instanceId, "secretary_sign_summary", who.secretary.id);
    expect((await openTask(run.instanceId, "chair_sign_decision")).assigneeUserId).toBe(who.vice.id);
    expect((await signDecision(run, who.vice, viceRoles, "APPROVED")).currentStepKeys).toEqual(["staff_prepare_certificate"]);
    const letter = await formOn(run.versionId, "F-39");
    const signature = await prisma.signatureEvent.findFirstOrThrow({ where: { formInstanceId: letter.id, fieldPath: "chair_signature" } });
    expect(signature.userId).toBe(who.vice.id);
    const files = await approveAndRelease(who, run, who.vice, viceRoles, bill.id);
    const kept = files.find((file) => file.code === "F-39" && file.audience === "STAFF");
    expect(await docxText(kept!.storageKey)).toContain(who.vice.displayName);
    expect(await docxText(kept!.storageKey)).not.toContain(who.chair.displayName);
  }, 600_000);

  it("bills the third review at 50% and sends F-38 without the reviewers' names or signatures", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Third ${crypto.randomUUID().slice(0, 6)}`);
    await submitAndScreen(who, run);
    const first = await determine(who, run, who.chair, ["PANEL_CHAIR"], "EXPEDITED");
    await review(who, run, "MINOR");
    await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: ["PANEL_CHAIR"], userId: who.chair.id, overrides: { recommended_action: "MINOR", icf_action: "MINOR" } });
    await finish(run.instanceId, "chair_review", who.chair.id, { outcome: "MINOR" });
    await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: who.staff.id });
    await finish(run.instanceId, "staff_sign_summary", who.staff.id);
    await signDecision(run, who.chair, ["PANEL_CHAIR"], "MINOR");
    await decideBill({ billId: first.id, actorUserId: who.staff.id, decision: "VERIFIED" });
    expect((await finish(run.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["await_revision"]);

    let releasedVersion = run.versionId;
    for (const round of [2, 3]) {
      await upload(releasedVersion, who.leader.id, "MANUSCRIPT");
      const revised = await startRevision(run.protocolId, who.leader.id);
      const instance = await running(run.protocolId);
      expect(instance.protocolVersionId).toBe(revised.id);
      const next = { protocolId: run.protocolId, versionId: revised.id, instanceId: instance.id };
      const actions = await formOn(revised.id, "F-38");
      const open = Object.values((actions.data as { praf?: Record<string, { needs_action?: boolean }> }).praf ?? {});
      expect(open.length).toBeGreaterThan(0);
      expect(open.every((row) => row.needs_action === true)).toBe(true);
      await writeForm({ ...next, code: "F-38", stepKey: "proponent_revise", roles: LEADER, userId: who.leader.id });
      await upload(revised.id, who.leader.id, "MANUSCRIPT");
      expect((await finish(next.instanceId, "proponent_revise", who.leader.id)).currentStepKeys).toEqual(["staff_screening"]);
      expect((await finish(next.instanceId, "staff_screening", who.staff.id, { outcome: "ACCEPT" })).currentStepKeys).toEqual(["reviewer_assess"]);
      const bills = await prisma.bill.findMany({ where: { protocolId: run.protocolId, round } });
      if (round === 2) expect(bills).toEqual([]);
      if (round === 3) {
        expect(bills).toHaveLength(1);
        expect(bills[0]).toMatchObject({ amount: 80_000, basis: "nthReview", status: "ISSUED" });
        expect(bills[0]!.description).toContain("3rd Review");
      }
      for (const reviewer of [who.scientist, who.layperson]) {
        // The scientist signs the protocol part, the non-scientist the ICF part.
        const block = reviewer === who.scientist ? { reviewer_name: `Dr. ${reviewer.familyName}` } : { icf_reviewer_name: `Dr. ${reviewer.familyName}` };
        const shared = await writeForm({ ...next, code: "F-38", stepKey: "reviewer_assess", roles: REVIEWER, userId: reviewer.id, overrides: block });
        if (reviewer === who.scientist) await sign(shared.id, "reviewer_signature", reviewer.id, revised.id);
        await finish(next.instanceId, "reviewer_assess", reviewer.id);
      }
      // Minor modifications last time, so no meeting.
      expect((await finish(next.instanceId, "chair_decide", who.chair.id, { outcome: "MINOR" })).currentStepKeys).toEqual(["chair_sign_decision"]);
      await writeForm({ ...next, code: "F-39", stepKey: "chair_sign_decision", roles: ["PANEL_CHAIR"], userId: who.chair.id, overrides: { decision: "MINOR" } });
      expect((await finish(next.instanceId, "chair_sign_decision", who.chair.id)).currentStepKeys).toEqual(["staff_release"]);
      if (round === 3) await decideBill({ billId: bills[0]!.id, actorUserId: who.staff.id, decision: "VERIFIED" });
      // Round 2 has no bill, so nothing blocks its release.
      expect((await finish(next.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["await_revision"]);
      if (round === 3) {
        await runDocumentJobs(next.instanceId);
        const files = await released(revised.id);
        const sent = files.find((file) => file.code === "F-38" && file.audience === "PROPONENT");
        const kept = files.find((file) => file.code === "F-38" && file.audience === "STAFF");
        expect(sent && kept).toBeTruthy();
        const sentText = await docxText(sent!.storageKey);
        expect(sentText).not.toContain(`Dr. ${who.scientist.familyName}`);
        expect(sentText).not.toContain(`Dr. ${who.layperson.familyName}`);
        const keptText = await docxText(kept!.storageKey);
        expect(keptText).toContain(`Dr. ${who.scientist.familyName}`);
        expect(keptText).toContain(`Dr. ${who.layperson.familyName}`);
      }
      releasedVersion = revised.id;
    }
  }, 900_000);
});
