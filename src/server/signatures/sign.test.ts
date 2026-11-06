import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { FormSchema } from "@/lib/forms/schema";
import { AuditAction } from "@/lib/audit-log";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { issueEmailCode } from "@/server/auth/codes";
import { createDefinition } from "@/server/forms/definitions";
import { saveField } from "@/server/forms/fill";
import { submitVersion } from "@/server/protocols/versions";
import { describeVerification, signField } from "@/server/signatures/sign";
import { saveSignatureImage } from "@/server/signatures/store";
import { makeUser, STRONG_PASSWORD } from "@/server/test/users";
import { confirmSigningStepUp, signingStepUpFresh } from "@/server/stepup";

const schema: FormSchema = {
  sections: [
    {
      id: "study",
      title: "Study",
      fields: [
        {
          id: "study_title",
          label: "Short title",
          type: "text",
          fillers: ["PROPONENT"],
          validation: { required: true },
        },
        {
          id: "signatures",
          label: "Researcher signatures",
          type: "signature",
          fillers: ["PROPONENT"],
          signer: { role: "PROPONENT", each: "researchers" },
          validation: { required: true },
        },
        {
          id: "adviser_signature",
          label: "Adviser signature",
          type: "signature",
          fillers: ["ADVISER"],
          signer: { role: "ADVISER" },
          validation: { required: true },
        },
      ],
    },
  ],
};

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

async function inkPng(): Promise<Buffer> {
  const mark = await sharp({
    create: { width: 30, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 120, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: mark, left: 12, top: 16 }])
    .png()
    .toBuffer();
}

describe("signing a form", () => {
  it("binds a signature to the form, voids it when the data changes, and blocks submit until every required signature is current", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({
      email: `lead.${suffix}@usc.edu.ph`,
      firstName: "Juan",
      familyName: "Cruz",
      password: STRONG_PASSWORD,
    });
    const co = await makeUser({
      email: `co.${suffix}@usc.edu.ph`,
      firstName: "Ana",
      familyName: "Reyes",
      password: STRONG_PASSWORD,
    });
    const adviser = await makeUser({
      email: `adv.${suffix}@usc.edu.ph`,
      firstName: "Luis",
      familyName: "Garcia",
      password: STRONG_PASSWORD,
    });
    const png = await inkPng();
    const first = await saveSignatureImage({ userId: leader.id, bytes: png, method: "DRAWN" });
    const second = await saveSignatureImage({ userId: leader.id, bytes: png, method: "UPLOADED" });
    expect(second.version).toBe(2);
    expect(second.active).toBe(true);
    expect(await prisma.signature.findUnique({ where: { id: first.id } })).toMatchObject({ active: false });
    await saveSignatureImage({ userId: co.id, bytes: png, method: "DRAWN" });
    await saveSignatureImage({ userId: adviser.id, bytes: png, method: "UPLOADED" });

    const protocol = await prisma.protocol.create({
      data: { title: "Signature study", leaderUserId: leader.id, createdById: leader.id, code: `USC-REC-${suffix}` },
    });
    const version = await prisma.protocolVersion.create({
      data: { protocolId: protocol.id, number: 1, label: "1/05Nov2026", state: "WORKING" },
    });
    await prisma.protocolMember.createMany({
      data: [
        { protocolId: protocol.id, userId: leader.id, role: "PROPONENT", isLeader: true, rosterOrder: 1, status: "ACTIVE" },
        { protocolId: protocol.id, userId: co.id, role: "PROPONENT", isLeader: false, rosterOrder: 2, status: "ACTIVE" },
        { protocolId: protocol.id, userId: adviser.id, role: "ADVISER", isLeader: false, rosterOrder: 3, status: "ACTIVE" },
      ],
    });
    const definition = await createDefinition({
      code: `F${suffix.slice(0, 6)}`,
      title: "Signature form",
      version: "01-00",
      effectiveDate: "2026-11-05",
      schema,
      userId: leader.id,
    });
    const instance = await prisma.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: version.id,
        data: {},
        status: "DRAFT",
      },
    });
    await saveField({
      instanceId: instance.id,
      path: "study_title",
      value: "Habits",
      expectedRevision: 0,
      userId: leader.id,
    });

    await expect(
      signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[0]", userId: leader.id, meta }),
    ).rejects.toMatchObject({ code: "STEP_UP_REQUIRED" });

    await prisma.signingStepUp.create({
      data: {
        userId: leader.id,
        confirmedAt: new Date(Date.now() - 11 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    });
    await expect(
      signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[0]", userId: leader.id, meta }),
    ).rejects.toMatchObject({ code: "STEP_UP_EXPIRED" });

    await confirmSigningStepUp({ userId: leader.id, password: STRONG_PASSWORD });
    const signed = await signField({
      formInstanceId: instance.id,
      fieldPath: "signatures.researchers[0]",
      userId: leader.id,
      meta,
    });
    expect(signed.verifyRef).toHaveLength(10);
    expect(await describeVerification(signed.verifyRef)).toMatchObject({
      formCode: definition.code,
      protocolCode: protocol.code,
      signerName: "Juan D. Cruz",
      matches: true,
    });

    await confirmSigningStepUp({ userId: co.id, password: STRONG_PASSWORD });
    await expect(
      signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[0]", userId: co.id, meta }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      signField({ formInstanceId: instance.id, fieldPath: "adviser_signature", userId: leader.id, meta }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[1]", userId: co.id, meta });

    const edited = await saveField({
      instanceId: instance.id,
      path: "study_title",
      value: "Revised habits",
      expectedRevision: 1,
      userId: co.id,
    });
    expect(edited).toMatchObject({ ok: true, signaturesVoided: true });
    const leaderEvent = await prisma.signatureEvent.findUnique({ where: { id: signed.id } });
    expect(leaderEvent?.voidReason).toBe("DATA_CHANGED");
    expect(leaderEvent?.voidedAt).toBeTruthy();
    expect(await describeVerification(signed.verifyRef)).toMatchObject({ matches: false });
    expect(
      await prisma.notification.count({ where: { userId: leader.id, type: "signature.voided" } }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { action: AuditAction.signatureVoided, protocolId: protocol.id } }),
    ).toBe(2);

    await prisma.setting.upsert({
      where: { key: "protocol.requiredForms" },
      create: { key: "protocol.requiredForms", value: [definition.code] },
      update: { value: [definition.code] },
    });
    await prisma.setting.upsert({
      where: { key: "protocol.requiredUploads" },
      create: { key: "protocol.requiredUploads", value: [] },
      update: { value: [] },
    });
    await expect(submitVersion(protocol.id, leader.id)).rejects.toMatchObject({ code: "INCOMPLETE" });

    await confirmSigningStepUp({ userId: leader.id, password: STRONG_PASSWORD });
    await signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[0]", userId: leader.id, meta });
    await confirmSigningStepUp({ userId: co.id, password: STRONG_PASSWORD });
    await signField({ formInstanceId: instance.id, fieldPath: "signatures.researchers[1]", userId: co.id, meta });
    await confirmSigningStepUp({ userId: adviser.id, password: STRONG_PASSWORD });
    await signField({ formInstanceId: instance.id, fieldPath: "adviser_signature", userId: adviser.id, meta });
    const submitted = await submitVersion(protocol.id, leader.id);
    expect(submitted.label).toBe("1/05Nov2026");
  }, 120_000);

  it("confirms an account without a password by email code", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const user = await makeUser({ email: `oauth.${suffix}@usc.edu.ph`, firstName: "Mia", familyName: "Santos" });
    const sent: { text: string }[] = [];
    await issueEmailCode({
      email: user.email!,
      purpose: "STEP_UP",
      userId: user.id,
      mailer: {
        async send(message) {
          sent.push(message);
        },
      },
    });
    const code = sent[0]?.text.match(/\d{6}/)?.[0] ?? "";
    await confirmSigningStepUp({ userId: user.id, code });
    expect(await signingStepUpFresh(user.id)).toBe(true);
    await expect(confirmSigningStepUp({ userId: user.id, code: "000000" })).rejects.toMatchObject({
      code: "CODE_INVALID",
    });
  });
});
