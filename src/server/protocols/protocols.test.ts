import { describe, expect, it } from "vitest";
import { AuditAction } from "@/lib/audit-log";
import { sampleFormSchema } from "@/lib/forms/sample";
import { prisma } from "@/server/db";
import { confirmRegistration, startRegistration } from "@/server/auth/register";
import { authorize } from "@/server/authz";
import { createDefinition, publishDefinition } from "@/server/forms/definitions";
import { saveField } from "@/server/forms/fill";
import { deleteObject, putObject } from "@/server/storage";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { decideFee } from "@/server/protocols/fees";
import { acceptInvite, inviteMember, moveRoster, removeMember, transferLeadership } from "@/server/protocols/members";
import { changePanel } from "@/server/protocols/details";
import { confirmUpload, downloadFile, prepareUpload } from "@/server/protocols/uploads";
import { diffVersions } from "@/server/protocols/read";
import { startRevision, submitVersion } from "@/server/protocols/versions";
import { formatDesignation } from "@/lib/affiliation";

const sent: { to: string; text: string }[] = [];
const mailer = {
  async send(message: { to: string; text: string }) {
    sent.push(message);
  },
};

describe("protocols, collaboration, and versions", () => {
  it("runs a shared protocol from invite through an immutable submission", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `leader.${suffix}@usc.edu.ph`, firstName: "Juan", familyName: "Cruz" });
    const co = await makeUser({ email: `co.${suffix}@usc.edu.ph`, firstName: "Ana", familyName: "Reyes" });
    const adviser = await makeUser({ email: `adviser.${suffix}@usc.edu.ph`, firstName: "Luis", familyName: "Garcia" });
    const pending = await makeUser({
      email: `pending.${suffix}@gmail.com`,
      firstName: "Mia",
      familyName: "Santos",
      status: "PENDING_APPROVAL",
    });
    const staff = await makeUser({ email: "admin@usc.edu.ph", firstName: "System", familyName: "Admin" });
    const panel = await prisma.panel.create({ data: { code: `P${suffix.slice(0, 4)}`, name: "Panel test" } });
    const discipline = await prisma.discipline.create({ data: { name: `Biology ${suffix}`, panelId: panel.id } });
    const otherPanel = await prisma.panel.create({ data: { code: `Q${suffix.slice(0, 4)}`, name: "Other panel" } });

    const definition = await createDefinition({
      code: `S${suffix.slice(0, 6)}`,
      title: "Collaboration form",
      version: "01-00",
      effectiveDate: "2026-11-05",
      schema: sampleFormSchema,
      userId: leader.id,
    });
    await publishDefinition(definition.id, leader.id);
    await prisma.setting.upsert({
      where: { key: "protocol.requiredForms" },
      create: { key: "protocol.requiredForms", value: [definition.code] },
      update: { value: [definition.code] },
    });

    const created = await createProtocolForUser(leader.id, {
      title: "Classroom study of study habits",
      disciplineId: discipline.id,
      researchType: "Applied",
      affiliation: {
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "3rd year",
        institution: "University of San Carlos",
        contactEmailId: leader.emails[0]!.id,
      },
    });
    expect(created.member).toMatchObject({ role: "PROPONENT", isLeader: true, rosterOrder: 1, status: "ACTIVE" });
    expect(created.protocol.panelId).toBe(panel.id);
    expect(created.version.state).toBe("WORKING");

    const invitedCo = await inviteMember(
      { protocolId: created.protocol.id, actorUserId: leader.id, email: co.email!, role: "PROPONENT" },
      mailer,
    );
    expect(invitedCo.userId).toBe(co.id);
    expect(invitedCo.status).toBe("INVITED");
    await acceptInvite({
      protocolId: created.protocol.id,
      userId: co.id,
      contactEmailId: co.emails[0]!.id,
      affiliationKind: "STUDENT",
      course: "BS Psychology",
      yearLabel: "2nd year",
      institution: "University of San Carlos",
      designation: formatDesignation({
        kind: "STUDENT",
        course: "BS Psychology",
        yearLabel: "2nd year",
        institution: "University of San Carlos",
      }),
    });

    const unknown = `new.${suffix}@gmail.com`;
    await inviteMember(
      { protocolId: created.protocol.id, actorUserId: leader.id, email: unknown, role: "PROPONENT" },
      mailer,
    );
    expect(sent.some((message) => message.to === unknown && message.text.includes("/sign-up?email="))).toBe(true);
    await startRegistration(
      { firstName: "Paolo", familyName: "Lim", email: unknown, password: STRONG_PASSWORD },
      mailer,
    );
    const code = sent.find((message) => message.text.includes("REC-DMS code"))?.text.match(/\d{6}/)?.[0] ?? "";
    const registered = await confirmRegistration(unknown, code);
    const bound = await prisma.protocolMember.findFirstOrThrow({
      where: { protocolId: created.protocol.id, invitedEmail: unknown },
    });
    expect(bound.userId).toBe(registered.id);

    await inviteMember(
      { protocolId: created.protocol.id, actorUserId: leader.id, email: adviser.email!, role: "ADVISER" },
      mailer,
    );
    await acceptInvite({
      protocolId: created.protocol.id,
      userId: adviser.id,
      contactEmailId: adviser.emails[0]!.id,
      affiliationKind: "FACULTY",
      position: "Associate Professor",
      unit: "Department of Biology",
      institution: "University of San Carlos",
      designation: "Associate Professor, Department of Biology, University of San Carlos",
    });

    const active = await prisma.protocolMember.count({
      where: { protocolId: created.protocol.id, role: "PROPONENT", status: "ACTIVE" },
    });
    expect(active).toBe(2);

    const instance = await prisma.formInstance.findFirstOrThrow({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: created.version.id, formDefinitionId: definition.id },
    });
    const [first, second] = await Promise.all([
      saveField({
        instanceId: instance.id,
        path: "study_title",
        value: "Habits",
        expectedRevision: 0,
        userId: leader.id,
      }),
      saveField({
        instanceId: instance.id,
        path: "human_participants",
        value: { choice: "NO" },
        expectedRevision: 0,
        userId: co.id,
      }),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const stored = await prisma.formInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(stored.data).toMatchObject({ study_title: "Habits", human_participants: { choice: "NO" } });

    const clash = await saveField({
      instanceId: instance.id,
      path: "study_title",
      value: "Other title",
      expectedRevision: 0,
      userId: co.id,
    });
    expect(clash).toMatchObject({ ok: false, code: "CONFLICT", changedBy: { name: "Juan D. Cruz" } });

    await expect(submitVersion(created.protocol.id, co.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pendingProtocol = await createProtocolForUser(pending.id, {
      title: "Pending leader study",
      disciplineId: discipline.id,
      researchType: "Basic",
      affiliation: {
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "1st year",
        institution: "University of San Carlos",
        contactEmailId: pending.emails[0]!.id,
      },
    });
    await expect(submitVersion(pendingProtocol.protocol.id, pending.id)).rejects.toMatchObject({ code: "PENDING_APPROVAL" });

    await expect(submitVersion(created.protocol.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });
    for (const kind of ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] as const) {
      const prepared = await prepareUpload({
        protocolId: created.protocol.id,
        userId: leader.id,
        kind,
        originalName: `${kind.toLowerCase()}.pdf`,
        mime: "application/pdf",
      });
      if (kind === "MANUSCRIPT") expect(prepared.suggestedName).toMatch(/^Manuscript_/);
      await putObject(prepared.storageKey, Buffer.from("%PDF-1.4 test"), "application/pdf");
      await confirmUpload({ intentId: prepared.intentId, userId: leader.id });
    }
    const manuscript = await prisma.storedFile.findFirstOrThrow({
      where: { protocolVersionId: created.version.id, kind: "MANUSCRIPT" },
    });
    const download = await downloadFile({ fileId: manuscript.id, userId: co.id });
    expect(download.url).toContain("http");
    await changePanel(created.protocol.id, staff.id, otherPanel.id);
    const submitted = await submitVersion(created.protocol.id, leader.id);
    expect(submitted.label).toBe(created.version.label);
    await expect(
      saveField({
        instanceId: instance.id,
        path: "study_title",
        value: "After submit",
        expectedRevision: stored.revision,
        userId: leader.id,
      }),
    ).rejects.toMatchObject({ code: "LOCKED" });
    await expect(
      prisma.protocolVersion.update({
        where: { id: created.version.id },
        data: { snapshot: { tampered: true } },
      }),
    ).rejects.toThrow(/immutable/i);

    const revision = await startRevision(created.protocol.id, leader.id);
    const copied = await prisma.formInstance.findFirstOrThrow({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: revision.id },
    });
    await saveField({
      instanceId: copied.id,
      path: "study_title",
      value: "Habits revised",
      expectedRevision: 0,
      userId: leader.id,
    });
    const diff = await diffVersions(leader.id, created.protocol.id, created.version.id, revision.id);
    expect(diff.some((form) => form.changes.some((change) => change.path === "study_title" && change.after === "Habits revised"))).toBe(true);

    const fee = await prisma.feeVerification.findFirstOrThrow({ where: { protocolVersionId: created.version.id } });
    await decideFee({ feeId: fee.id, actorUserId: staff.id, decision: "VERIFIED" });
    const coMember = await prisma.protocolMember.findFirstOrThrow({
      where: { protocolId: created.protocol.id, userId: co.id },
    });
    await moveRoster(created.protocol.id, leader.id, coMember.id, "down");
    await transferLeadership(created.protocol.id, leader.id, coMember.id);
    const adviserMember = await prisma.protocolMember.findFirstOrThrow({
      where: { protocolId: created.protocol.id, userId: adviser.id },
    });
    await removeMember(created.protocol.id, co.id, adviserMember.id);

    await authorize(staff, "protocol.panel", { type: "protocol", id: pendingProtocol.protocol.id });
    await expect(authorize(leader, "protocol.review", { type: "protocol", id: created.protocol.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(authorize(adviser, "protocol.view", { type: "protocol", id: created.protocol.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const actions = await prisma.auditEvent.findMany({
      where: { protocolId: created.protocol.id },
      select: { action: true },
    });
    const names = new Set(actions.map((row) => row.action));
    for (const action of [
      AuditAction.protocolCreated,
      AuditAction.memberInvited,
      AuditAction.memberAccepted,
      AuditAction.inviteBound,
      AuditAction.fieldSaved,
      AuditAction.fileUploaded,
      AuditAction.versionSubmitted,
      AuditAction.revisionStarted,
      AuditAction.feeVerified,
      AuditAction.rosterReordered,
      AuditAction.leadershipTransferred,
      AuditAction.memberRemoved,
      AuditAction.fileDownloaded,
      AuditAction.panelChanged,
    ]) {
      expect(names.has(action)).toBe(true);
    }
    const uploaded = await prisma.storedFile.findMany({ where: { protocolVersionId: created.version.id } });
    for (const file of uploaded) {
      await deleteObject(file.storageKey).catch(() => undefined);
    }
  }, 120_000);
});
