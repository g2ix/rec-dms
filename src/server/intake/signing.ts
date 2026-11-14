import "server-only";
import type { FormInstance, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { isRoleKey } from "@/lib/forms/roles";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { parseGraph } from "@/lib/workflow/graph";
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

/**
 * The forms a researcher signs with one act on an intake version, in print order: F-27 and F-28 on
 * the first submission, F-38 on a revision (INTAKE-04). Only the forms the open proponent step
 * requires are signed.
 */
export const INTAKE_SIGNED_FORMS = ["F-27", "F-28", "F-38"] as const;
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

/**
 * The forms the leader's open step on this version requires to be filled or signed: what the
 * engine checks before that step completes. Empty when no proponent step is open.
 */
export async function formsRequiredInOpenStep(db: Db, versionId: string): Promise<Set<string>> {
  const instance = await db.workflowInstance.findFirst({
    where: { protocolVersionId: versionId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { version: true, tasks: { where: { status: { in: ["OPEN", "CLAIMED"] }, kind: "MAIN" } } },
  });
  const graph = instance ? parseGraph(instance.version.graph) : null;
  if (!instance || !graph?.ok) return new Set();
  const codes = new Set<string>();
  for (const task of instance.tasks) {
    const step = graph.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.assignee?.kind !== "PROTOCOL_LEADER") continue;
    for (const form of step.forms ?? []) if (form.required && form.mode !== "VIEW" && !form.slot) codes.add(form.code);
  }
  return codes;
}

/**
 * The forms one signing act covers on this version: those the open proponent step requires, or
 * F-27 and F-28 when no step says (a draft before the workflow starts). Empty on a version whose
 * forms are signed one by one.
 */
export async function formsToSignNow(db: Db, versionId: string): Promise<IntakeSigningForm[]> {
  const listed = await intakeSigningForms(db, versionId);
  const required = await formsRequiredInOpenStep(db, versionId);
  const asked = INTAKE_SIGNED_FORMS.filter((code) => required.has(code));
  const wanted = listed.filter((form) => required.has(form.code));
  // Every form the step asks to sign must be printed from the intake; otherwise each is signed on its own.
  if (asked.length > 0) return wanted.length === asked.length ? wanted : [];
  const first = listed.filter((form) => form.code === "F-27" || form.code === "F-28");
  return first.length === 2 ? first : [];
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
    const listed = await formsToSignNow(tx, version.id);
    if (listed.length === 0) {
      throw new AppError("INVALID", "On this version the forms are signed one by one, on the Forms tab.", 400);
    }
    const codes = new Set(listed.map((form) => form.code));
    // Lock both copies, in a fixed order, then read them again: a change made meanwhile is seen.
    for (const id of listed.map((form) => form.instance.id).sort()) {
      await tx.$queryRaw`SELECT id FROM form_instances WHERE id = ${id} FOR UPDATE`;
    }
    const forms = (await intakeSigningForms(tx, version.id)).filter((form) => codes.has(form.code));
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

    const created: { code: IntakeSignedForm; id: string; verifyRef: string; again: boolean }[] = [];
    for (const form of forms) {
      const slot = researcherSlot(form.schema, roster, input.userId);
      if (!slot) throw new AppError("INVALID", `You have no signature row on ${form.code}.`, 400);
      const target = slotByPath(form.schema, roster, slot.fieldPath);
      if (!target || !canSignSlot(target.field, target.slot, { userId: input.userId, roles })) {
        throw new AppError("FORBIDDEN", `You cannot sign ${form.code}.`, 403);
      }
      const live = await tx.signatureEvent.findFirst({ where: { formInstanceId: form.instance.id, fieldPath: slot.fieldPath, voidedAt: null } });
      if (live) continue;
      const again = Boolean(await tx.signatureEvent.findFirst({ where: { formInstanceId: form.instance.id, fieldPath: slot.fieldPath, userId: input.userId, voidedAt: { not: null } } }));
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
      created.push({ code: form.code, id: event.id, verifyRef: event.verifyRef, again });
    }
    if (created.length === 0) throw new AppError("ALREADY_SIGNED", `You have already signed ${[...codes].join(" and ")}.`, 409);

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
