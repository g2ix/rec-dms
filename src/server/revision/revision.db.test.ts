import PizZip from "pizzip";
import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { manilaDay } from "@/lib/workflow/calendar";
import { prisma } from "@/server/db";
import { generateDecisionDocuments } from "@/server/docs/generate";
import { renderFormDocument } from "@/server/docs/render";
import { decideBill } from "@/server/fees/bills";
import { saveIntakeSection } from "@/server/intake/service";
import { intakeState } from "@/server/intake/state";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { startRevision } from "@/server/protocols/versions";
import { downloadFile } from "@/server/protocols/uploads";
import { versionHistory } from "@/server/revision/history";
import { addDraftNote, answerNote } from "@/server/revision/notes";
import { returnedView } from "@/server/revision/returned";
import { formAccess, requireFormAccess } from "@/server/revision/visibility";
import { fillIntake, finish, formOn, grant, running, upload, writeForm } from "@/server/test/usc-cycle";
import { makeUser } from "@/server/test/users";
import { protocolTaskComments } from "@/server/workflow/comments";
import { startInstance } from "@/server/workflow/engine";
import { FEE_RULES, installProcess2026, memoRates } from "../../../prisma/seed/usc-rec/install-2026-11";
import { PROCESS_START } from "../../../prisma/seed/usc-rec/workflows-2026-11";

// Object storage in memory: generated forms and carried-over uploads are written and read back.
const objects = new Map<string, Uint8Array>();
vi.mock("@/server/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage")>()),
  putObject: async (key: string, body: Uint8Array) => {
    objects.set(key, body);
  },
  getObjectBytes: async (key: string) => ({ body: objects.get(key) ?? new Uint8Array(Buffer.from(`bytes of ${key}`)) }),
  deleteObject: async (key: string) => {
    objects.delete(key);
  },
  getSignedDownloadUrl: async (key: string) => `memory://${key}`,
}));
vi.mock("@/server/docs/pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/docs/pdf")>()),
  convertDocxToPdf: async () => new Uint8Array(Buffer.from("%PDF-1.4\n%%EOF\n")),
}));
vi.mock("@/server/audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/audit")>()),
  auditRequestMeta: async (extra: Record<string, unknown> = {}) => ({ ...extra }),
}));

const LEADER = ["PROPONENT", "PROJECT_LEADER"];
const STAFF = ["REC_STAFF"];
const REVIEWER = ["REVIEWER"];
const CHAIR = ["PANEL_CHAIR"];
const CREATED_ON = new Date(PROCESS_START.getTime() + 3 * 24 * 60 * 60 * 1000);

type Run = { protocolId: string; versionId: string; instanceId: string };

async function people(suffix: string) {
  const make = (key: string, familyName: string) => makeUser({ email: `i4.${key}.${suffix}@usc.edu.ph`, firstName: key, familyName });
  const all = {
    leader: await make("leader", "Cruz"),
    adviser: await make("adviser", "Adviser"),
    staff: await make("staff", "Staff"),
    chair: await make("chair", "Chair"),
    scientist: await make("scientist", "Scientist"),
    layperson: await make("layperson", "Layperson"),
  };
  const panel = await prisma.panel.create({ data: { code: `I${suffix}`, name: `Panel ${suffix}` } });
  await grant(all.staff.id, "REC_STAFF");
  await grant(all.chair.id, "PANEL_CHAIR", panel.id, { isScientist: true, designation: "Chair" });
  await grant(all.scientist.id, "PANEL_MEMBER", panel.id, { isScientist: true, designation: "Scientist" });
  await grant(all.layperson.id, "PANEL_MEMBER", panel.id, { isScientist: false, designation: "Non-scientist" });
  return { ...all, panel };
}
type People = Awaited<ReturnType<typeof people>>;

async function newProtocol(who: People, title: string, withAdviser: boolean): Promise<Run> {
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
    if (withAdviser) await tx.protocolMember.create({ data: { protocolId, userId: who.adviser.id, role: "ADVISER", status: "ACTIVE", rosterOrder: 9 } });
  });
  const instance = await startInstance("INITIAL_SUBMISSION", protocolId, versionId, who.leader.id);
  return { protocolId, versionId, instanceId: instance.id };
}

async function prepare(who: People, run: Run) {
  await fillIntake(run.protocolId, run.versionId);
  for (const code of ["F-27", "F-28", "F-30", "F-35", "F-36"]) await writeForm({ ...run, code, stepKey: "proponent_submit", roles: LEADER, userId: who.leader.id });
  await upload(run.versionId, who.leader.id, "MANUSCRIPT");
  await upload(run.versionId, who.leader.id, "COVER_LETTER");
}

async function screen(who: People, run: Run) {
  await writeForm({ ...run, code: "F-26", stepKey: "staff_screening", roles: STAFF, userId: who.staff.id, overrides: { submission_type: "INITIAL" } });
  return finish(run.instanceId, "staff_screening", who.staff.id, { outcome: "ACCEPT" });
}

async function memberOf(protocolId: string, userId: string) {
  return prisma.protocolMember.findFirstOrThrow({ where: { protocolId, userId, status: "ACTIVE" } });
}

/** Keep the "Needs action" flag on these points only (the chair unflags the rest during consolidation). */
async function flagOnly(versionId: string, code: string, keep: Record<string, number>) {
  const form = await formOn(versionId, code);
  const data = { ...(form.data as Record<string, Record<string, Record<string, unknown>>>) };
  const kept: string[] = [];
  for (const field of Object.keys(keep)) {
    const table = { ...(data[field] ?? {}) };
    let left = keep[field]!;
    for (const [rowId, cells] of Object.entries(table)) {
      const flag = left > 0 && cells.needs_action === true;
      if (flag) {
        left -= 1;
        kept.push(`${field}.${rowId}`);
      }
      table[rowId] = { ...cells, needs_action: flag };
    }
    data[field] = table;
  }
  await prisma.$transaction(async (tx) => {
    if (form.status === "LOCKED") await tx.$executeRaw`SELECT set_config('recdms.form_review', 'on', true)`;
    await tx.formInstance.update({ where: { id: form.id }, data: { data: data as never } });
  });
  return kept;
}

async function runDocumentJobs(instanceId: string) {
  const jobs = await prisma.job.findMany({ where: { kind: "GENERATE_DOCUMENTS", doneAt: null, payload: { path: ["instanceId"], equals: instanceId } } });
  for (const job of jobs) {
    await generateDecisionDocuments(job.payload);
    await prisma.job.update({ where: { id: job.id }, data: { doneAt: new Date() } });
  }
}

async function docxText(bytes: Uint8Array): Promise<string> {
  return (new PizZip(Buffer.from(bytes)).file("word/document.xml")?.asText() ?? "").replace(/<[^>]+>/g, "");
}

async function notices(protocolId: string, templateKey: string) {
  const jobs = await prisma.job.findMany({ where: { kind: "NOTIFY", payload: { path: ["protocolId"], equals: protocolId } } });
  return jobs.filter((job) => (job.payload as { templateKey?: string }).templateKey === templateKey).map((job) => job.payload as { userIds: string[]; link?: string });
}

describe("INTAKE-04: Returned for revision", () => {
  let fixtureScheduleId = "";

  beforeAll(async () => {
    const owner = await makeUser({ email: `i4.owner.${crypto.randomUUID().slice(0, 8)}@usc.edu.ph`, familyName: "Owner" });
    await installProcess2026(prisma as unknown as PrismaClient, owner.id);
    const fixture = await prisma.feeSchedule.create({
      data: { effectiveFrom: new Date(`${manilaDay(new Date())}T00:00:00.000Z`), approvedRef: "INTAKE-04 test copy", rates: { create: memoRates() }, rules: { create: FEE_RULES } },
    });
    fixtureScheduleId = fixture.id;
  }, 600_000);

  afterAll(async () => {
    await prisma.setting.updateMany({ where: { key: "revision.releasedForms" }, data: { value: ["F-37", "F-38", "F-39", "F-40", "F-42"] } });
    if (!fixtureScheduleId) return;
    await prisma.bill.deleteMany({ where: { scheduleId: fixtureScheduleId } });
    await prisma.feeSchedule.delete({ where: { id: fixtureScheduleId } });
  });

  it("keeps the review from the proponents until release, then shows the 3 flagged points, carries the intake and keeps version 1 as it was", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Panel return ${crypto.randomUUID().slice(0, 6)}`, false);
    await prepare(who, run);
    // No adviser: the submission goes straight to REC.
    expect((await finish(run.instanceId, "proponent_submit", who.leader.id)).currentStepKeys).toEqual(["staff_screening"]);
    await screen(who, run);
    await writeForm({ ...run, code: "F-31", stepKey: "determine_review", roles: CHAIR, userId: who.chair.id, overrides: { exempt: "NO", review_type: "EXPEDITED", submission_type: "INITIAL" } });
    await finish(run.instanceId, "determine_review", who.chair.id, { outcome: "EXPEDITED", reviewerSlots: { SCIENTIST: who.scientist.id, NON_SCIENTIST: who.layperson.id }, reviewDueDate: "2027-01-20" });
    for (const reviewer of [who.scientist, who.layperson]) await finish(run.instanceId, "reviewer_accept", reviewer.id, { outcome: "ACCEPT" });
    const scientist = await memberOf(run.protocolId, who.scientist.id);
    const layperson = await memberOf(run.protocolId, who.layperson.id);
    await writeForm({ ...run, code: "F-35", stepKey: "reviewer_assess", roles: REVIEWER, userId: who.scientist.id, memberId: scientist.id, overrides: { recommended_action: "MINOR", reviewer_name: "Dr. Hidden Scientist" } });
    await finish(run.instanceId, "reviewer_assess", who.scientist.id, { comment: "Reviewer note never shown to the proponents." });
    await writeForm({ ...run, code: "F-36", stepKey: "reviewer_assess", roles: REVIEWER, userId: who.layperson.id, memberId: layperson.id, overrides: { recommended_action: "MINOR", reviewer_name: "Dr. Hidden Layperson" } });
    await finish(run.instanceId, "reviewer_assess", who.layperson.id);

    // Under review: no comments, and every review form is refused (403), the reviewers' own copies too.
    const f35 = await formOn(run.versionId, "F-35");
    const f36 = await formOn(run.versionId, "F-36");
    const f37 = await formOn(run.versionId, "F-37");
    const reviewerCopy = await formOn(run.versionId, "F-35", scientist.id);
    for (const form of [f35, f36, f37, reviewerCopy]) {
      expect((await formAccess(prisma, who.leader.id, form.id)).kind).toBe("denied");
      await expect(requireFormAccess(prisma, who.leader.id, form.id)).rejects.toMatchObject({ status: 403 });
    }
    expect((await formAccess(prisma, who.staff.id, f35.id)).kind).toBe("full");
    expect((await protocolTaskComments(who.leader.id, run.protocolId)).comments.map((item) => item.comment)).not.toContain("Reviewer note never shown to the proponents.");
    expect(await returnedView(who.leader.id, run.protocolId)).toBeNull();
    // A generated file of a review form is refused too, by file id.
    const rendered = await renderFormDocument({ instanceId: f35.id, format: "docx", userId: who.staff.id });
    await expect(downloadFile({ fileId: rendered.fileId, userId: who.leader.id })).rejects.toMatchObject({ status: 403 });

    // The chair keeps 3 points flagged: 2 on the protocol, 1 on the consent form.
    const kept = await flagOnly(run.versionId, "F-37", { praf: 2, icf: 1 });
    expect(kept).toHaveLength(3);
    await writeForm({ ...run, code: "F-37", stepKey: "chair_review", roles: CHAIR, userId: who.chair.id, overrides: { recommended_action: "MINOR", icf_action: "MINOR" } });
    await finish(run.instanceId, "chair_review", who.chair.id, { outcome: "MINOR" });
    await writeForm({ ...run, code: "F-37", stepKey: "staff_sign_summary", roles: STAFF, userId: who.staff.id });
    await finish(run.instanceId, "staff_sign_summary", who.staff.id);
    await writeForm({ ...run, code: "F-37", stepKey: "chair_sign_decision", roles: CHAIR, userId: who.chair.id });
    await writeForm({ ...run, code: "F-39", stepKey: "chair_sign_decision", roles: CHAIR, userId: who.chair.id, overrides: { decision: "MINOR" } });
    await finish(run.instanceId, "chair_sign_decision", who.chair.id);
    // Endorsed by the chair but not released yet: still nothing.
    expect((await formAccess(prisma, who.leader.id, f37.id)).kind).toBe("denied");
    const bill = await prisma.bill.findFirstOrThrow({ where: { protocolId: run.protocolId, round: 1 } });
    await decideBill({ billId: bill.id, actorUserId: who.staff.id, decision: "VERIFIED" });
    expect((await finish(run.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["await_revision"]);
    await runDocumentJobs(run.instanceId);

    // Released: F-37 opens as its release copy; F-35 and F-36 stay refused.
    expect((await formAccess(prisma, who.leader.id, f37.id)).kind).toBe("released");
    expect((await formAccess(prisma, who.leader.id, f35.id)).kind).toBe("denied");
    expect((await formAccess(prisma, who.leader.id, f36.id)).kind).toBe("denied");
    expect((await notices(run.protocolId, "protocol.returned_for_revision"))[0]).toMatchObject({ userIds: [who.leader.id], link: `/app/protocols/${run.protocolId}/intake` });

    // REC can take F-37 off the list without code.
    await prisma.setting.upsert({ where: { key: "revision.releasedForms" }, update: { value: ["F-39"] }, create: { key: "revision.releasedForms", value: ["F-39"] } });
    expect((await formAccess(prisma, who.leader.id, f37.id)).kind).toBe("denied");
    await prisma.setting.update({ where: { key: "revision.releasedForms" }, data: { value: ["F-37", "F-38", "F-39", "F-40", "F-42"] } });

    const waiting = await returnedView(who.leader.id, run.protocolId);
    expect(waiting).toMatchObject({ role: "PANEL", roleLabel: "Panel", versionNumber: 2, started: false, canStart: true, next: "REC" });
    expect(waiting!.panelRows).toHaveLength(3);
    expect(waiting!.released.map((form) => form.code)).toEqual(["F-37", "F-39"]);
    expect(JSON.stringify(waiting)).not.toContain("Hidden");

    // Version 2 starts from version 1's intake and cover letter; the manuscript is uploaded again.
    const before = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId } });
    const v1Files = await prisma.storedFile.findMany({ where: { protocolVersionId: run.versionId, kind: { in: ["MANUSCRIPT", "COVER_LETTER"] } }, orderBy: { id: "asc" } });
    const v2 = await startRevision(run.protocolId, who.leader.id);
    const v2Intake = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: v2.id } });
    expect(v2Intake.scoping).toEqual(before.scoping);
    expect(v2Intake.actions).toEqual({});
    const carried = await prisma.storedFile.findMany({ where: { protocolVersionId: v2.id } });
    expect(carried.map((file) => file.kind)).toEqual(["COVER_LETTER"]);
    expect(carried[0]!.carriedFromId).toBe(v1Files.find((file) => file.kind === "COVER_LETTER")!.id);

    const started = await returnedView(who.leader.id, run.protocolId);
    expect(started).toMatchObject({ started: true, versionNumber: 2, next: "REC", manuscript: { required: true, file: null, suggestedName: expect.stringMatching(/^Manuscript_2-/) } });
    expect(started!.panelRows).toHaveLength(3);
    expect(started!.uploads[0]).toMatchObject({ kind: "COVER_LETTER", tag: "Carried over from version 1" });

    // The proponents answer the 3 rows, upload the manuscript, sign F-38 and resubmit.
    const instance = await running(run.protocolId);
    const next = { protocolId: run.protocolId, versionId: v2.id, instanceId: instance.id };
    await fillIntake(run.protocolId, v2.id);
    await prisma.protocolIntake.update({ where: { protocolVersionId: v2.id }, data: { coi: { kind: "SPECIFY", text: "Changed on version 2 only." } } });
    await writeForm({ ...next, code: "F-38", stepKey: "proponent_revise", roles: LEADER, userId: who.leader.id });
    await upload(v2.id, who.leader.id, "MANUSCRIPT");
    expect((await finish(next.instanceId, "proponent_revise", who.leader.id)).currentStepKeys).toEqual(["staff_screening"]);

    // F-38 prints exactly those 3 rows with the actions typed.
    const state = await intakeState(prisma, v2.id);
    expect(state!.actionPoints).toHaveLength(3);
    const f38 = await formOn(v2.id, "F-38");
    const printed = await docxText((await renderFormDocument({ instanceId: f38.id, format: "docx", userId: who.leader.id, view: "proponent" })).bytes);
    for (const point of state!.actionPoints) expect(printed).toContain(`Revised as asked on page 2, paragraph 1 (${point.code}).`);

    // Version 1 is unchanged: its intake and its files.
    const after = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId } });
    expect(after.coi).toEqual(before.coi);
    expect(after.actions).toEqual(before.actions);
    expect(after.revision).toBe(before.revision);
    expect(await prisma.storedFile.findMany({ where: { protocolVersionId: run.versionId, kind: { in: ["MANUSCRIPT", "COVER_LETTER"] } }, orderBy: { id: "asc" } })).toEqual(v1Files);

    // Round 2: the panel keeps 1 point open. Version 3 shows only that row, with the earlier action.
    await finish(next.instanceId, "staff_screening", who.staff.id, { outcome: "ACCEPT" });
    for (const reviewer of [who.scientist, who.layperson]) {
      const block = reviewer === who.scientist ? { reviewer_name: "Dr. Hidden" } : { icf_reviewer_name: "Dr. Hidden" };
      await writeForm({ ...next, code: "F-38", stepKey: "reviewer_assess", roles: REVIEWER, userId: reviewer.id, overrides: block });
      await finish(next.instanceId, "reviewer_assess", reviewer.id);
    }
    const stillOpen = await flagOnly(v2.id, "F-38", { praf: 1, icf: 0 });
    expect(stillOpen).toHaveLength(1);
    await finish(next.instanceId, "chair_decide", who.chair.id, { outcome: "MINOR" });
    await writeForm({ ...next, code: "F-39", stepKey: "chair_sign_decision", roles: CHAIR, userId: who.chair.id, overrides: { decision: "MINOR" } });
    await finish(next.instanceId, "chair_sign_decision", who.chair.id);
    expect((await finish(next.instanceId, "staff_release", who.staff.id, { outcome: "RELEASE" })).currentStepKeys).toEqual(["await_revision"]);
    await runDocumentJobs(next.instanceId);
    const v3 = await startRevision(run.protocolId, who.leader.id);
    const third = await returnedView(who.leader.id, run.protocolId);
    expect(third!.versionNumber).toBe(3);
    expect(third!.panelRows).toHaveLength(1);
    expect(third!.panelRows[0]!.earlierAction).toMatch(/^Revised as asked on page 2, paragraph 1/);
    expect(v3.number).toBe(3);

    // History: every version, with only the forms the proponents may open.
    const history = await versionHistory(who.leader.id, run.protocolId);
    expect(history.map((version) => version.number)).toEqual([1, 2, 3]);
    const firstForms = history[0]!.forms.map((form) => form.code);
    expect(firstForms).toContain("F-37");
    expect(firstForms).not.toContain("F-35");
    expect(firstForms).not.toContain("F-36");
    expect(firstForms).not.toContain("F-31");
    expect(JSON.stringify(history)).not.toContain(who.scientist.displayName);
  }, 900_000);

  it("lets the adviser and REC Staff return with comments on sections, and names the next step", async () => {
    const who = await people(crypto.randomUUID().slice(0, 6));
    const run = await newProtocol(who, `Adviser return ${crypto.randomUUID().slice(0, 6)}`, true);
    await prepare(who, run);
    // With an adviser, the submission goes to the adviser first, who is told.
    expect((await finish(run.instanceId, "proponent_submit", who.leader.id)).currentStepKeys).toEqual(["adviser_check"]);
    expect((await notices(run.protocolId, "revision.ready_for_adviser")).length).toBeGreaterThan(0);
    // Submitted: the proponents cannot change the version while the adviser has it.
    const fresh = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId } });
    await expect(
      saveIntakeSection({ protocolId: run.protocolId, userId: who.leader.id, section: "coi", value: { kind: "NONE" }, expectedRevision: fresh.revision }),
    ).rejects.toMatchObject({ code: "LOCKED" });

    await addDraftNote({ userId: who.adviser.id, protocolId: run.protocolId, anchor: "coi", body: "Declare the grant from your department." });
    await addDraftNote({ userId: who.adviser.id, protocolId: run.protocolId, anchor: "upload:MANUSCRIPT", body: "Add the instrument as Appendix B." });
    // Returning needs no F-38 or other signature.
    expect((await finish(run.instanceId, "adviser_check", who.adviser.id, { outcome: "RETURN", comment: "Two things before REC." })).currentStepKeys).toEqual(["proponent_submit"]);
    expect((await notices(run.protocolId, "protocol.returned_for_revision"))[0]!.userIds).toEqual([who.leader.id]);

    const byAdviser = await returnedView(who.leader.id, run.protocolId);
    expect(byAdviser).toMatchObject({ role: "ADVISER", roleLabel: "Adviser", versionNumber: 1, started: true, next: "ADVISER", comment: "Two things before REC." });
    expect(byAdviser!.notes.map((note) => [note.section, note.roleLabel])).toEqual([
      ["coi", "Adviser"],
      ["documents", "Adviser"],
    ]);
    expect(byAdviser!.panelRows).toEqual([]);

    // Each comment is an open item until ticked Done; then the leader resubmits.
    const gaps = (await intakeState(prisma, run.versionId))!.gaps.filter((gap) => gap.section === "returnNotes");
    expect(gaps).toHaveLength(2);
    await expect(finish(run.instanceId, "proponent_submit", who.leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });
    for (const note of byAdviser!.notes) await answerNote({ userId: who.leader.id, noteId: note.id, done: true, reply: "Done." });
    expect((await finish(run.instanceId, "proponent_submit", who.leader.id)).currentStepKeys).toEqual(["adviser_check"]);
    expect((await finish(run.instanceId, "adviser_check", who.adviser.id, { outcome: "FORWARD" })).currentStepKeys).toEqual(["staff_screening"]);

    // A draft that does not go out with a return is dropped.
    await addDraftNote({ userId: who.staff.id, protocolId: run.protocolId, anchor: "study", body: "Spell out the site." });
    await writeForm({ ...run, code: "F-26", stepKey: "staff_screening", roles: STAFF, userId: who.staff.id, overrides: { submission_type: "INITIAL" } });
    expect((await finish(run.instanceId, "staff_screening", who.staff.id, { outcome: "RETURN_INCOMPLETE" })).currentStepKeys).toEqual(["proponent_submit"]);
    const byStaff = await returnedView(who.leader.id, run.protocolId);
    expect(byStaff).toMatchObject({ role: "REC_STAFF", roleLabel: "REC Staff", versionNumber: 1, next: "ADVISER" });
    expect(byStaff!.notes.map((note) => [note.section, note.body])).toEqual([["study", "Spell out the site."]]);
  }, 900_000);
});
