import "server-only";
import type { FormInstance, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { isRoleKey } from "@/lib/forms/roles";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { canSignSlot, signatureSlots, slotByPath, type RosterMember } from "@/lib/signatures/target";
import { audit, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { proponentOn, workingVersion } from "@/server/intake/access";
import { actorRoles, createSignatureEvent, toRoster } from "@/server/signatures/sign";
import { assertFreshSigningStepUp } from "@/server/stepup";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type Meta = Prisma.InputJsonObject;

/** The two forms a researcher signs with one act on an intake version, in print order. */
export const INTAKE_SIGNED_FORMS = ["F-27", "F-28"] as const;
export type IntakeSignedForm = (typeof INTAKE_SIGNED_FORMS)[number];

export type ResearcherFormStatus = "signed" | "void" | "unsigned";

export type ResearcherSigning = {
  /** Per form: signed (a live event on the researcher's slot), void (the latest one was voided) or unsigned. */
  forms: Partial<Record<IntakeSignedForm, { status: ResearcherFormStatus; fieldPath: string; eventId: string | null; signedAt: Date | null; signatureId: string | null }>>;
};

export type IntakeSigningForm = { code: IntakeSignedForm; instance: FormInstance & { formDefinition: { code: string; title: string; schema: unknown } }; schema: FormSchema };

/**
 * The shared F-27 and F-28 copies of a version when they are printed from the intake (11-01).
 * Older versions (09-01 / 10-01) return none: their forms are still signed one by one.
 */
export async function intakeSigningForms(db: Db, versionId: string): Promise<IntakeSigningForm[]> {
  const rows = await db.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: null, formDefinition: { code: { in: [...INTAKE_SIGNED_FORMS] } } },
    include: { formDefinition: true },
  });
  const forms = rows.flatMap((instance) => {
    const check = validateSchema(instance.formDefinition.schema);
    if (!check.ok || check.schema.source !== "intake") return [];
    return [{ code: instance.formDefinition.code as IntakeSignedForm, instance, schema: check.schema }];
  });
  return forms.sort((a, b) => INTAKE_SIGNED_FORMS.indexOf(a.code) - INTAKE_SIGNED_FORMS.indexOf(b.code));
}

/** A researcher's own slot on a form, found by account rather than by roster position. */
function researcherSlot(schema: FormSchema, roster: RosterMember[], userId: string) {
  return signatureSlots(schema, roster).find((slot) => slot.role === "PROPONENT" && slot.userId === userId && slot.fieldPath.includes(".researchers[")) ?? null;
}

/** Each researcher's signature status on F-27 and F-28, keyed by user id. */
export async function researcherSigning(db: Db, forms: IntakeSigningForm[], roster: RosterMember[]): Promise<Map<string, ResearcherSigning>> {
  const result = new Map<string, ResearcherSigning>();
  if (forms.length === 0) return result;
  const events = await db.signatureEvent.findMany({
    where: { formInstanceId: { in: forms.map((form) => form.instance.id) } },
    select: { id: true, formInstanceId: true, fieldPath: true, userId: true, voidedAt: true, signedAt: true, signatureId: true },
    orderBy: { signedAt: "desc" },
  });
  for (const member of roster) {
    if (member.role !== "PROPONENT" || !member.userId) continue;
    const entry: ResearcherSigning = { forms: {} };
    for (const form of forms) {
      const slot = researcherSlot(form.schema, roster, member.userId);
      if (!slot) continue;
      const mine = events.filter((event) => event.formInstanceId === form.instance.id && event.fieldPath === slot.fieldPath && event.userId === member.userId);
      const live = mine.find((event) => !event.voidedAt) ?? null;
      const latest = live ?? mine[0] ?? null;
      entry.forms[form.code] = {
        status: live ? "signed" : latest ? "void" : "unsigned",
        fieldPath: slot.fieldPath,
        eventId: latest?.id ?? null,
        signedAt: latest?.signedAt ?? null,
        signatureId: latest?.signatureId ?? null,
      };
    }
    result.set(member.userId, entry);
  }
  return result;
}

async function rosterOf(db: Db, protocolId: string): Promise<RosterMember[]> {
  return toRoster(
    await db.protocolMember.findMany({
      where: { protocolId, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { displayName: true } } },
    }),
  );
}

export async function intakeRoster(db: Db, protocolId: string) {
  return rosterOf(db, protocolId);
}

/**
 * One signing act for the current researcher: one signature event on F-27 and one on F-28, each
 * hashed over that form's own printed content and linked to its agreement, plus one `intake.signed`
 * audit event naming both. A form whose signature is still live is left alone, so signing again after
 * a change re-signs only the voided form. Any failure rolls back the whole act.
 */
export async function signIntakeForms(input: { protocolId: string; userId: string; meta: Meta; now?: Date }) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const member = await proponentOn(tx, input.protocolId, input.userId);
    const version = await workingVersion(tx, input.protocolId);
    const listed = await intakeSigningForms(tx, version.id);
    if (listed.length !== INTAKE_SIGNED_FORMS.length) {
      throw new AppError("INVALID", "On this version F-27 and F-28 are signed one by one, on the Forms tab.", 400);
    }
    // Lock both copies, in a fixed order, then read them again: a change made meanwhile is seen.
    for (const id of listed.map((form) => form.instance.id).sort()) {
      await tx.$queryRaw`SELECT id FROM form_instances WHERE id = ${id} FOR UPDATE`;
    }
    const forms = await intakeSigningForms(tx, version.id);
    if (forms.some((form) => form.instance.status !== "DRAFT")) {
      throw new AppError("LOCKED", "This version is submitted and cannot be signed.", 409);
    }

    const intake = await tx.protocolIntake.findUnique({ where: { protocolVersionId: version.id }, include: { agreements: true } });
    const agreementOf = (kind: string) => intake?.agreements.find((item) => item.memberId === member.id && item.kind === kind) ?? null;
    if (!agreementOf("DECLARATIONS") || !agreementOf("F28_CONSENT")) {
      throw new AppError("AGREEMENT_REQUIRED", "Agree to the F-27 declarations and give the F-28 consents before you sign.", 400);
    }

    await assertFreshSigningStepUp(tx, input.userId, now);
    const signature = await tx.signature.findFirst({ where: { userId: input.userId, active: true }, orderBy: { version: "desc" } });
    if (!signature) throw new AppError("SIGNATURE_REQUIRED", "Save a signature image under My signature before signing.", 400);

    const roster = await rosterOf(tx, input.protocolId);
    const grants = await tx.userRole.findMany({ where: { userId: input.userId, revokedAt: null }, select: { role: { select: { key: true } } } });
    const roles = [...actorRoles(member), ...grants.map((grant) => grant.role.key).filter(isRoleKey)];

    const created: { code: IntakeSignedForm; id: string; verifyRef: string }[] = [];
    for (const form of forms) {
      const slot = researcherSlot(form.schema, roster, input.userId);
      if (!slot) throw new AppError("INVALID", `You have no signature row on ${form.code}.`, 400);
      const target = slotByPath(form.schema, roster, slot.fieldPath);
      if (!target || !canSignSlot(target.field, target.slot, { userId: input.userId, roles })) {
        throw new AppError("FORBIDDEN", `You cannot sign ${form.code}.`, 403);
      }
      const live = await tx.signatureEvent.findFirst({ where: { formInstanceId: form.instance.id, fieldPath: slot.fieldPath, voidedAt: null } });
      if (live) continue;
      const kind = target.field.signer?.agreement;
      const event = await createSignatureEvent(tx, {
        instance: form.instance,
        schema: form.schema,
        fieldPath: slot.fieldPath,
        userId: input.userId,
        signature,
        protocolId: input.protocolId,
        actingRole: actorRoles(member)[0] ?? null,
        agreementId: kind ? (agreementOf(kind)?.id ?? null) : null,
        meta: input.meta,
        now,
      });
      created.push({ code: form.code, id: event.id, verifyRef: event.verifyRef });
    }
    if (created.length === 0) throw new AppError("ALREADY_SIGNED", "You have already signed F-27 and F-28.", 409);

    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: actorRoles(member)[0] ?? null,
      action: AuditAction.intakeSigned,
      entityType: "protocol_intake",
      entityId: intake!.id,
      protocolId: input.protocolId,
      diff: diffOf(
        {},
        {
          forms: created.map((item) => item.code),
          signatureEventIds: created.map((item) => item.id),
          verifyRefs: created.map((item) => item.verifyRef),
        },
      ),
      meta: input.meta,
    });
    return { signed: created };
  });
}
