import type { PrismaClient } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { validateSchema } from "@/lib/forms/schema";
import { formDataHash, signatureFieldIds } from "@/lib/signatures/hash";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { backfillIntake } from "@/server/intake/backfill";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { saveIntakeSection, setAgreement, withdrawIntakeSigning } from "@/server/intake/service";
import { signIntakeForms } from "@/server/intake/signing";
import { describeVerification } from "@/server/signatures/sign";
import { intakeState } from "@/server/intake/state";
import { generatedFormList, generatedFormPreview, intakePageExtras } from "@/server/intake/page";
import { getSubmissionChecklist } from "@/server/protocols/checklist";
import { railSections } from "@/lib/intake/rail";
import { submitSummary } from "@/lib/protocols/checklist";
import { updateStudyFields } from "@/server/protocols/details";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { updateSharedDetails } from "@/server/protocols/details";
import { ensureWorkingForms } from "@/server/protocols/versions";
import { fillIntake, finish, running, signatureIdFor, upload, writeForm } from "@/server/test/usc-cycle";
import { makeUser } from "@/server/test/users";
import { installUscRec } from "../../../prisma/seed/usc-rec/install";

async function newProtocol(label: string) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const leader = await makeUser({ email: `intake.${label}.${suffix}@usc.edu.ph`, familyName: "Leader" });
  const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
  const created = await createProtocolForUser(leader.id, {
    title: `Intake ${label} ${suffix}`,
    researchType: "Social / Behavioral Research",
    affiliation: { kind: "STUDENT", course: "BS Psychology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
  });
  await prisma.$transaction((tx) => ensureWorkingForms(tx, created.version.id));
  return { leader, protocolId: created.protocol.id, versionId: created.version.id, suffix };
}

async function addMember(protocolId: string, role: "PROPONENT" | "ADVISER", label: string) {
  const user = await makeUser({ email: `intake.${label}.${crypto.randomUUID().slice(0, 8)}@usc.edu.ph`, familyName: label });
  await prisma.protocolMember.create({ data: { protocolId, userId: user.id, role, status: "ACTIVE", rosterOrder: 2 } });
  return user;
}

const details = {
  title: "Study habits of Grade 10 learners",
  institution: "University of San Carlos",
  institutionAddress: "Talamban, Cebu City",
  researchType: "Social / Behavioral Research",
  researchTypeCodes: ["SOCIAL_BEHAVIORAL"],
  researchTypeOther: "",
  durationMonths: 6,
  expectedParticipants: 30,
  studySite: "Talamban campus",
  fundingSources: [{ code: "RESEARCHER", name: "Researcher-funded", detail: "" }],
};

describe("intake", () => {
  beforeAll(async () => {
    await installUscRec(prisma as unknown as PrismaClient);
  }, 600_000);

  it("prints a new protocol's forms from 11-01, with no F-27 field to type", async () => {
    const run = await newProtocol("new");
    const f27 = await prisma.formInstance.findFirstOrThrow({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-27" } }, include: { formDefinition: true } });
    expect(f27.formDefinition.version).toBe("11-01");
    expect(await prisma.formInstance.count({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-29" } } })).toBe(0);
    await updateSharedDetails(run.protocolId, run.leader.id, details);
    const data = await effectiveFormData(prisma, f27);
    expect(data.protocol_title).toBe(details.title);
    expect(data.duration).toBe(6);
    expect(data.funds).toEqual(["RESEARCHER"]);
  }, 120_000);

  it("saves a section as a proponent, audits it, refuses an adviser, and reports another proponent's newer save", async () => {
    const run = await newProtocol("save");
    const adviser = await addMember(run.protocolId, "ADVISER", "Adviser");
    const second = await addMember(run.protocolId, "PROPONENT", "Second");
    const saved = await saveIntakeSection({ protocolId: run.protocolId, userId: run.leader.id, section: "scoping", value: { minors: false }, expectedRevision: 0 });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.revision).toBe(1);
    const audited = await prisma.auditEvent.findFirst({ where: { protocolId: run.protocolId, action: "intake.section_saved" } });
    expect(audited?.actorUserId).toBe(run.leader.id);

    await expect(
      saveIntakeSection({ protocolId: run.protocolId, userId: adviser.id, section: "coi", value: { kind: "NONE" }, expectedRevision: 1 }),
    ).rejects.toBeInstanceOf(AppError);

    const conflict = await saveIntakeSection({ protocolId: run.protocolId, userId: second.id, section: "scoping", value: { minors: true }, expectedRevision: 0 });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok && "code" in conflict) expect(conflict.code).toBe("CONFLICT");
    // A different section saved from a stale revision is accepted: nobody else changed it.
    const other = await saveIntakeSection({ protocolId: run.protocolId, userId: second.id, section: "coi", value: { kind: "NONE" }, expectedRevision: 0 });
    expect(other.ok).toBe(true);
  }, 120_000);

  it("marks N/A from the scoping answers and keeps them out of the references the proponent gives", async () => {
    const run = await newProtocol("scoping");
    await saveIntakeSection({ protocolId: run.protocolId, userId: run.leader.id, section: "scoping", value: { minors: false, personalData: false }, expectedRevision: 0 });
    const bound = await versionBoundValues(prisma, run.versionId);
    const na = bound["intake.na"] as Record<string, Record<string, string[]>>;
    expect(Object.keys(na["F-36"] ?? {})).toEqual(["A.07"]);
    expect(Object.keys(na["F-35"] ?? {})).toHaveLength(9);
    const state = await intakeState(prisma, run.versionId);
    const f36 = state!.groups.find((group) => group.form === "F-36")!;
    expect(f36.points.find((point) => point.code === "A.07")!.na).toEqual(["no minors among the participants"]);
    expect(f36.points.some((point) => point.code === "1")).toBe(false);
    // The rail and checklist get a count; the Where to find it table highlights the codes in the detail.
    const references = state!.gaps.find((gap) => gap.section === "references")!;
    const codes = references.detail!.codes;
    expect(references.message).toBe(`${codes.length} points still need a page reference.`);
    expect(references.message).not.toMatch(/\d+\.\d+/);
    expect(codes).not.toContain("A.07");
    expect(codes).not.toContain("3.02");
    expect(codes).toContain("2.10");
  }, 120_000);

  it("follows a Details change on F-27: new revision, voided signature", async () => {
    const run = await newProtocol("details");
    await updateSharedDetails(run.protocolId, run.leader.id, details);
    await setAgreement({ protocolId: run.protocolId, userId: run.leader.id, kind: "DECLARATIONS", agreed: true });
    const f27 = await prisma.formInstance.findFirstOrThrow({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-27" } }, include: { formDefinition: true } });
    const check = validateSchema(f27.formDefinition.schema);
    if (!check.ok) throw new Error("F-27 schema");
    const event = await prisma.signatureEvent.create({
      data: {
        formInstanceId: f27.id,
        fieldPath: "proponent_signatures.researchers[0]",
        userId: run.leader.id,
        signatureId: await signatureIdFor(run.leader.id),
        dataHash: formDataHash(await effectiveFormData(prisma, f27), signatureFieldIds(check.schema)),
        protocolVersionId: run.versionId,
        signedAt: new Date(),
        verifyRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      },
    });
    await updateSharedDetails(run.protocolId, run.leader.id, { ...details, title: "Reading habits of Grade 9 learners", durationMonths: 9 });
    const bound = await versionBoundValues(prisma, run.versionId);
    expect(bound["protocol.title"]).toBe("Reading habits of Grade 9 learners");
    expect(bound["protocol.durationMonths"]).toBe(9);
    const after = await prisma.formInstance.findUniqueOrThrow({ where: { id: f27.id } });
    expect(after.revision).toBe(f27.revision + 1);
    expect(after.data).toEqual(f27.data);
    expect((await prisma.signatureEvent.findUniqueOrThrow({ where: { id: event.id } })).voidReason).toBe("DATA_CHANGED");
  }, 120_000);

  it("withdrawing an agreement voids that researcher's linked signature", async () => {
    const run = await newProtocol("agree");
    await setAgreement({ protocolId: run.protocolId, userId: run.leader.id, kind: "F28_CONSENT", agreed: true });
    const intake = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId }, include: { agreements: true } });
    const f28 = await prisma.formInstance.findFirstOrThrow({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-28" } } });
    const event = await prisma.signatureEvent.create({
      data: {
        formInstanceId: f28.id,
        fieldPath: "signatures.researchers[0]",
        userId: run.leader.id,
        signatureId: await signatureIdFor(run.leader.id),
        dataHash: "x",
        protocolVersionId: run.versionId,
        signedAt: new Date(),
        verifyRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      },
    });
    await prisma.intakeAgreement.update({ where: { id: intake.agreements[0]!.id }, data: { signatureEventId: event.id } });
    await setAgreement({ protocolId: run.protocolId, userId: run.leader.id, kind: "F28_CONSENT", agreed: false });
    expect((await prisma.signatureEvent.findUniqueOrThrow({ where: { id: event.id } })).voidReason).toBe("AGREEMENT_WITHDRAWN");
    expect(await prisma.intakeAgreement.count({ where: { intakeId: intake.id } })).toBe(0);
  }, 120_000);

  it("Intake page: the rail's missing counts equal the submit check, and drop as the Study and Funding fields save", async () => {
    const run = await newProtocol("rail");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: run.leader.id } });
    const started = Date.now();
    const extras = await intakePageExtras(user, run.protocolId, 1);
    const elapsed = Date.now() - started;
    const checklist = await getSubmissionChecklist(run.leader.id, run.protocolId);
    expect(checklist).not.toBeNull();
    const railTotal = extras.rail.reduce((sum, section) => sum + section.missing.length, 0);
    expect(railTotal).toBe(extras.missing.length);
    expect(submitSummary(checklist!)).toMatch(new RegExp(`^${extras.missing.length} items? left`));
    expect(extras.rail.map((section) => section.key)).toEqual(["study", "team", "funding", "participants", "coi", "references", "documents", "sign"]);
    expect(extras.submit?.to).toBe("REC");
    // Loads one row per generated form; the previews load on demand.
    expect(extras.forms.map((form) => form.code)).toEqual(["F-27", "F-28", "F-30", "F-35", "F-36"]);
    console.info(`intakePageExtras took ${elapsed} ms`);

    const fundingBefore = extras.rail.find((section) => section.key === "funding")!.missing.length;
    await updateStudyFields(run.protocolId, run.leader.id, { title: "Study habits of Grade 10 learners, edited", funding: [{ code: "RESEARCHER", detail: "" }] });
    await updateStudyFields(run.protocolId, run.leader.id, { durationMonths: 6, expectedParticipants: 30, studySite: "Talamban campus" });
    const after = railSections(await getSubmissionChecklist(run.leader.id, run.protocolId), { revision: false });
    expect(after.find((section) => section.key === "funding")!.missing.length).toBe(fundingBefore - 1);
    expect(after.find((section) => section.key === "study")!.missing.map((item) => item.key)).not.toContain("details.study");

    // The title edit reaches the F-27 preview.
    const f27 = (await generatedFormList(run.versionId)).find((form) => form.code === "F-27")!;
    const preview = await generatedFormPreview(run.leader.id, run.protocolId, f27.instanceId);
    expect(JSON.stringify(preview.data)).toContain("Study habits of Grade 10 learners, edited");
    expect(preview.roles).toContain("PROPONENT");
  }, 120_000);

  it("Intake page: NA on every reference leaves nothing missing under Where to find it (the F-35 and F-36 rows are the intake's)", async () => {
    const run = await newProtocol("references");
    const state = await intakeState(prisma, run.versionId);
    const references = Object.fromEntries(state!.groups.flatMap((group) => group.points.filter((point) => point.na.length === 0).map((point) => [point.code, "NA" as const])));
    expect(Object.keys(references).length).toBeGreaterThan(0);
    await saveIntakeSection({ protocolId: run.protocolId, userId: run.leader.id, section: "references", value: references, expectedRevision: 0 });
    const checklist = await getSubmissionChecklist(run.leader.id, run.protocolId);
    // The forms printed from the intake are not listed again under Forms: their progress would count the reviewers' columns.
    const keys = checklist!.groups.flatMap((group) => group.items.map((item) => item.key));
    for (const code of ["F-27", "F-28", "F-30", "F-35", "F-36"]) expect(keys).not.toContain(`forms.${code}`);
    expect(railSections(checklist, { revision: false }).find((section) => section.key === "references")!.missing).toEqual([]);
  }, 120_000);

  describe("one signing act for F-27 and F-28", () => {
    async function readyToSign(userId: string, protocolId: string) {
      for (const kind of ["DECLARATIONS", "F28_CONSENT"] as const) await setAgreement({ protocolId, userId, kind, agreed: true });
      await signatureIdFor(userId);
      await prisma.signingStepUp.create({ data: { userId, confirmedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 60_000) } });
    }
    const live = (versionId: string, userId: string) =>
      prisma.signatureEvent.findMany({
        where: { userId, voidedAt: null, formInstance: { ownerType: "PROTOCOL_VERSION", ownerId: versionId } },
        include: { formInstance: { include: { formDefinition: { select: { code: true } } } } },
      });
    const codes = (events: Awaited<ReturnType<typeof live>>) => events.map((event) => event.formInstance.formDefinition.code).sort();

    it("creates one verifiable event per form, audits both under intake.signed, and signs only for the caller", async () => {
      const run = await newProtocol("sign1");
      await updateSharedDetails(run.protocolId, run.leader.id, details);
      const second = await addMember(run.protocolId, "PROPONENT", "Second");
      const adviser = await addMember(run.protocolId, "ADVISER", "Adviser");
      await readyToSign(run.leader.id, run.protocolId);

      const { signed } = await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });
      expect(signed.map((item) => item.code)).toEqual(["F-27", "F-28"]);
      const events = await live(run.versionId, run.leader.id);
      expect(codes(events)).toEqual(["F-27", "F-28"]);
      for (const event of events) expect((await describeVerification(event.verifyRef))?.matches).toBe(true);
      // Each event points at its own agreement.
      const agreements = await prisma.intakeAgreement.findMany({ where: { intake: { protocolVersionId: run.versionId }, signatureEventId: { not: null } } });
      expect(new Set(agreements.map((item) => item.signatureEventId))).toEqual(new Set(events.map((event) => event.id)));
      const audited = await prisma.auditEvent.findFirstOrThrow({ where: { protocolId: run.protocolId, action: "intake.signed" } });
      expect(JSON.stringify(audited.diff)).toContain(events[0]!.id);
      expect(JSON.stringify(audited.diff)).toContain(events[1]!.id);
      expect(await prisma.auditEvent.count({ where: { protocolId: run.protocolId, action: "form.signed" } })).toBe(2);

      // Signing twice adds nothing; nobody signs for someone else.
      await expect(signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} })).rejects.toMatchObject({ code: "ALREADY_SIGNED" });
      await expect(signIntakeForms({ protocolId: run.protocolId, userId: second.id, meta: {} })).rejects.toMatchObject({ code: "AGREEMENT_REQUIRED" });
      await expect(signIntakeForms({ protocolId: run.protocolId, userId: adviser.id, meta: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await live(run.versionId, second.id)).toHaveLength(0);
    }, 120_000);

    it("leaves nothing signed when one form cannot be signed", async () => {
      const run = await newProtocol("sign2");
      await readyToSign(run.leader.id, run.protocolId);
      // F-28 is already locked (as if submitted): the whole act fails, and F-27 stays unsigned.
      const f28 = await prisma.formInstance.findFirstOrThrow({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-28" } } });
      await prisma.formInstance.update({ where: { id: f28.id }, data: { status: "COMPLETE" } });
      await expect(signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} })).rejects.toMatchObject({ code: "LOCKED" });
      expect(await live(run.versionId, run.leader.id)).toHaveLength(0);
      expect(await prisma.auditEvent.count({ where: { protocolId: run.protocolId, action: { in: ["form.signed", "intake.signed"] } } })).toBe(0);
    }, 120_000);

    it("voids per form: the title voids both with one notice, an F-27-only change voids F-27, and signing again re-signs only that", async () => {
      const run = await newProtocol("sign3");
      await updateSharedDetails(run.protocolId, run.leader.id, details);
      await readyToSign(run.leader.id, run.protocolId);
      await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });

      await updateStudyFields(run.protocolId, run.leader.id, { title: "Reading habits of Grade 9 learners" });
      expect(await live(run.versionId, run.leader.id)).toHaveLength(0);
      const notices = await prisma.notification.findMany({ where: { userId: run.leader.id, type: "intake.signatures_voided" } });
      expect(notices).toHaveLength(1);
      expect(notices[0]!.body).toContain("F-27 and F-28");
      expect(notices[0]!.body).toContain("the study title changed");
      let state = await intakeState(prisma, run.versionId);
      expect(state!.researchers[0]!.signatures).toEqual({ "F-27": "void", "F-28": "void" });

      await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });
      // F-28 does not print the conflict of interest, so only F-27 is voided.
      await saveIntakeSection({ protocolId: run.protocolId, userId: run.leader.id, section: "coi", value: { kind: "SPECIFY", text: "Paid consultant" }, expectedRevision: 0 });
      expect(codes(await live(run.versionId, run.leader.id))).toEqual(["F-28"]);
      state = await intakeState(prisma, run.versionId);
      expect(state!.researchers[0]!.signatures).toEqual({ "F-27": "void", "F-28": "signed" });
      expect(state!.gaps.find((gap) => gap.section === "agreements")?.message).toMatch(/sign F-27 again\.$/);

      const again = await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });
      expect(again.signed.map((item) => item.code)).toEqual(["F-27"]);
      expect(codes(await live(run.versionId, run.leader.id))).toEqual(["F-27", "F-28"]);
    }, 120_000);

    it("withdrawing either agreement, or Withdraw on the row, voids both signatures", async () => {
      const run = await newProtocol("sign4");
      await readyToSign(run.leader.id, run.protocolId);
      await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });
      await setAgreement({ protocolId: run.protocolId, userId: run.leader.id, kind: "DECLARATIONS", agreed: false });
      expect(await live(run.versionId, run.leader.id)).toHaveLength(0);
      expect(await prisma.signatureEvent.count({ where: { userId: run.leader.id, voidReason: "AGREEMENT_WITHDRAWN" } })).toBe(2);

      await readyToSign(run.leader.id, run.protocolId);
      await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });
      await withdrawIntakeSigning({ protocolId: run.protocolId, userId: run.leader.id });
      expect(await live(run.versionId, run.leader.id)).toHaveLength(0);
      expect(await prisma.intakeAgreement.count({ where: { intake: { protocolVersionId: run.versionId } } })).toBe(0);
    }, 120_000);

    it("with three researchers, the rail shows 2 missing and submit is blocked until everyone has signed", async () => {
      const run = await newProtocol("sign5");
      const others = [await addMember(run.protocolId, "PROPONENT", "Second"), await addMember(run.protocolId, "PROPONENT", "Third")];
      await fillIntake(run.protocolId, run.versionId);
      const instance = await running(run.protocolId);
      for (const code of ["F-30", "F-35", "F-36"]) {
        await writeForm({ ...run, code, stepKey: "proponent_submit", roles: ["PROPONENT", "PROJECT_LEADER"], userId: run.leader.id });
      }
      await upload(run.versionId, run.leader.id, "MANUSCRIPT");
      await upload(run.versionId, run.leader.id, "COVER_LETTER");
      await readyToSign(run.leader.id, run.protocolId);
      await signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} });

      const sign = railSections(await getSubmissionChecklist(run.leader.id, run.protocolId), { revision: false }).find((section) => section.key === "sign")!;
      expect(sign.total).toBe(3);
      expect(sign.missing).toHaveLength(2);
      await expect(finish(instance.id, "proponent_submit", run.leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });

      for (const other of others) {
        await readyToSign(other.id, run.protocolId);
        await signIntakeForms({ protocolId: run.protocolId, userId: other.id, meta: {} });
      }
      const after = railSections(await getSubmissionChecklist(run.leader.id, run.protocolId), { revision: false }).find((section) => section.key === "sign")!;
      expect(after.missing).toHaveLength(0);
      expect((await finish(instance.id, "proponent_submit", run.leader.id)).currentStepKeys).not.toContain("proponent_submit");
    }, 180_000);

    it("leaves older protocols alone: no one-act signing on a version not printed from the intake", async () => {
      const run = await newProtocol("sign6");
      await readyToSign(run.leader.id, run.protocolId);
      // Swap the F-27 copy onto a definition that is not intake-sourced, as on a 09-01 / 10-01 protocol.
      const old = await prisma.formDefinition.findFirstOrThrow({ where: { code: "F-27", NOT: { version: "11-01" } }, orderBy: { version: "asc" } });
      const f27 = await prisma.formInstance.findFirstOrThrow({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-27" } } });
      await prisma.formInstance.update({ where: { id: f27.id }, data: { formDefinitionId: old.id } });
      await expect(signIntakeForms({ protocolId: run.protocolId, userId: run.leader.id, meta: {} })).rejects.toMatchObject({ code: "INVALID" });
      expect(await live(run.versionId, run.leader.id)).toHaveLength(0);
    }, 120_000);
  });

  it("autosaves one Study field without touching the others, and refuses an empty title", async () => {
    const run = await newProtocol("study-patch");
    await updateStudyFields(run.protocolId, run.leader.id, { studySite: "Downtown campus" });
    const protocol = await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } });
    expect(protocol.studySite).toBe("Downtown campus");
    expect(protocol.title).toMatch(/^Intake study-patch/);
    await expect(updateStudyFields(run.protocolId, run.leader.id, { title: "  " })).rejects.toThrow();
    await expect(updateStudyFields(run.protocolId, run.leader.id, { funding: [{ code: "AGENCY", detail: "" }] })).rejects.toThrow();
  }, 120_000);

  it("the scoping-rules migration updates the INTAKE-01 value on deploy and leaves a staff-changed value alone", async () => {
    const { SCOPING_RULES_11, SCOPING_RULES_11_INTAKE01 } = await import("../../../prisma/seed/usc-rec/scoping-11");
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("prisma/migrations/20261113100000_scoping_rules_keep_f36_d/migration.sql", "utf8");
    const key = "intake.scopingRules";
    const before = await prisma.setting.findUniqueOrThrow({ where: { key } });
    const run = () => prisma.$executeRawUnsafe(sql);
    const read = async () => (await prisma.setting.findUniqueOrThrow({ where: { key } })).value;
    try {
      await prisma.setting.update({ where: { key }, data: { value: SCOPING_RULES_11_INTAKE01 as never } });
      expect(await run()).toBe(1);
      expect(await read()).toEqual(JSON.parse(JSON.stringify(SCOPING_RULES_11)));

      expect(await run()).toBe(0);

      const staff = SCOPING_RULES_11_INTAKE01.filter((rule) => rule.id !== "focus-groups");
      await prisma.setting.update({ where: { key }, data: { value: staff as never } });
      expect(await run()).toBe(0);
      expect(await read()).toEqual(JSON.parse(JSON.stringify(staff)));
    } finally {
      await prisma.setting.update({ where: { key }, data: { value: before.value as never } });
    }
  }, 120_000);

  it("refuses deleting an agreement of a submitted version, and still deletes a whole protocol", async () => {
    const run = await newProtocol("frozen-delete");
    await setAgreement({ protocolId: run.protocolId, userId: run.leader.id, kind: "DECLARATIONS", agreed: true });
    const intake = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId }, include: { agreements: true } });
    const agreement = intake.agreements[0]!;
    await prisma.protocolVersion.update({ where: { id: run.versionId }, data: { state: "SUBMITTED", submittedAt: new Date(), submittedById: run.leader.id } });

    await expect(prisma.intakeAgreement.delete({ where: { id: agreement.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRaw`DELETE FROM intake_agreements WHERE intake_id = ${intake.id}`).rejects.toThrow(/immutable/);
    expect(await prisma.intakeAgreement.count({ where: { intakeId: intake.id } })).toBe(1);

    // The protocol cleanup src/lib/reports/load-data.ts uses: workflow rows are RESTRICT, the versions cascade.
    await prisma.task.deleteMany({ where: { instance: { protocolId: run.protocolId } } });
    await prisma.workflowInstance.deleteMany({ where: { protocolId: run.protocolId } });
    await prisma.protocol.delete({ where: { id: run.protocolId } });
    expect(await prisma.protocolIntake.count({ where: { id: intake.id } })).toBe(0);
    expect(await prisma.intakeAgreement.count({ where: { id: agreement.id } })).toBe(0);
  }, 120_000);

  it("backfills F-27 answers into empty protocol fields and the intake, logs them, and leaves the form copy alone", async () => {
    const run = await newProtocol("backfill");
    const old = await prisma.formDefinition.findUniqueOrThrow({ where: { code_version: { code: "F-27", version: "09-01" } } });
    await prisma.formInstance.deleteMany({ where: { ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, formDefinition: { code: "F-27" } } });
    const answers = {
      duration: "6 months",
      participants: "about thirty Grade 10 learners",
      study_site: "Talamban campus",
      research_type: ["SOCIAL_BEHAVIORAL"],
      funds: ["AGENCY"],
      fund_agency: "DOST-PCHRD",
      fund_amounts: "DOST-PCHRD ₱20,000",
      conflict: "DECLARED",
      conflict_details: "The adviser sits on the school board.",
    };
    const copy = await prisma.formInstance.create({ data: { formDefinitionId: old.id, ownerType: "PROTOCOL_VERSION", ownerId: run.versionId, data: answers } });
    await prisma.protocol.update({ where: { id: run.protocolId }, data: { durationMonths: null, expectedParticipants: null, studySite: "", researchTypeCodes: [], fundingSources: [] } });

    const [entry] = await backfillIntake({ protocolIds: [run.protocolId] });
    expect(entry?.copied).toMatchObject({ durationMonths: 6, studySite: "Talamban campus", researchTypeCodes: ["SOCIAL_BEHAVIORAL"], fundingSources: ["AGENCY"] });
    expect(entry?.skipped.map((skip) => skip.field)).toEqual(["expectedParticipants", "fund_amounts"]);
    const protocol = await prisma.protocol.findUniqueOrThrow({ where: { id: run.protocolId } });
    expect(protocol.durationMonths).toBe(6);
    expect(protocol.expectedParticipants).toBeNull();
    expect(protocol.fundingSources).toEqual([{ code: "AGENCY", name: "Agency other than institution: DOST-PCHRD", detail: "DOST-PCHRD" }]);
    const intake = await prisma.protocolIntake.findUniqueOrThrow({ where: { protocolVersionId: run.versionId } });
    expect(intake.coi).toEqual({ kind: "SPECIFY", text: "The adviser sits on the school board." });
    expect((await prisma.formInstance.findUniqueOrThrow({ where: { id: copy.id } })).data).toEqual(answers);
    expect(await prisma.auditEvent.count({ where: { protocolId: run.protocolId, action: "intake.backfilled" } })).toBe(1);

    // A second run finds nothing new to copy and logs nothing.
    expect(await backfillIntake({ protocolIds: [run.protocolId] })).toEqual([]);
    expect(await prisma.auditEvent.count({ where: { protocolId: run.protocolId, action: "intake.backfilled" } })).toBe(1);
  }, 120_000);
});
