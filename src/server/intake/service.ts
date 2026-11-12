import "server-only";
import { Prisma, type IntakeAgreementKind } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import type { SaveConflict } from "@/lib/forms/conflict";
import { validateSchema } from "@/lib/forms/schema";
import {
  actionsSchema,
  budgetLinesSchema,
  coiSchema,
  readIntake,
  referencesSchema,
  scopingSchema,
  type IntakeSection,
  type IntakeValues,
} from "@/lib/intake/model";
import { formDataHash, signatureFieldIds } from "@/lib/signatures/hash";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { voidSignaturesForDataChange } from "@/server/signatures/sign";

type Tx = Prisma.TransactionClient;
type Meta = Prisma.InputJsonObject;

/** Where each section is stored on the intake row. */
const COLUMN: Record<IntakeSection, "scoping" | "coi" | "budgetLines" | "references" | "actions"> = {
  scoping: "scoping",
  coi: "coi",
  budget: "budgetLines",
  references: "references",
  actions: "actions",
};

const SECTION_SCHEMA = {
  scoping: scopingSchema,
  coi: coiSchema,
  budget: budgetLinesSchema,
  references: referencesSchema,
  actions: actionsSchema,
} as const;

export function isIntakeSection(value: string): value is IntakeSection {
  return value in COLUMN;
}

export type IntakeSaveSuccess = {
  ok: true;
  revision: number;
  data: Record<string, unknown>;
  writtenPaths: string[];
  signaturesVoided: boolean;
};

/** The intake of the working version, created on first use. */
export async function ensureIntake(tx: Tx, versionId: string) {
  const existing = await tx.protocolIntake.findUnique({ where: { protocolVersionId: versionId } });
  if (existing) return existing;
  return tx.protocolIntake.create({ data: { protocolVersionId: versionId } });
}

async function proponentOn(tx: Tx, protocolId: string, userId: string) {
  const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
  if (!member || member.role !== "PROPONENT") {
    throw new AppError("FORBIDDEN", "Only the proponents of this protocol can fill the intake.", 403);
  }
  return member;
}

async function workingVersion(tx: Tx, protocolId: string) {
  const version = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
  if (!version) throw new AppError("LOCKED", "This version is submitted and cannot be edited.", 409);
  return version;
}

/** Intake-sourced form copies on a version, with the data they print and are signed with. */
async function intakeForms(tx: Tx, versionId: string) {
  const instances = await tx.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId },
    include: { formDefinition: true },
  });
  const forms = instances.flatMap((instance) => {
    const check = validateSchema(instance.formDefinition.schema);
    return check.ok && check.schema.source === "intake" ? [{ instance, schema: check.schema }] : [];
  });
  if (forms.length === 0) return [];
  const bound = await versionBoundValues(tx, versionId);
  return Promise.all(forms.map(async (form) => ({ ...form, effective: await effectiveFormData(tx, form.instance, bound) })));
}

/**
 * After the intake or the Details page changes: each intake form copy whose printed content
 * changed gets a new revision (so a stored print is not reused) and its signatures are voided,
 * as an edit on the form itself would do.
 */
export async function refreshIntakeForms(
  tx: Tx,
  input: {
    versionId: string;
    before: Awaited<ReturnType<typeof intakeForms>>;
    protocolId: string;
    actorUserId: string;
    meta: Meta;
  },
): Promise<number> {
  const after = await intakeForms(tx, input.versionId);
  let voided = 0;
  for (const form of after) {
    const earlier = input.before.find((item) => item.instance.id === form.instance.id);
    if (!earlier) continue;
    const ids = signatureFieldIds(form.schema);
    if (formDataHash(earlier.effective, ids) === formDataHash(form.effective, ids)) continue;
    if (form.instance.status === "DRAFT") {
      await tx.formInstance.update({ where: { id: form.instance.id }, data: { revision: { increment: 1 } } });
    }
    voided += await voidSignaturesForDataChange(tx, {
      instance: form.instance,
      schema: form.schema,
      before: earlier.effective,
      after: form.effective,
      protocolId: input.protocolId,
      actorUserId: input.actorUserId,
      meta: input.meta,
    });
  }
  return voided;
}

/** Takes the "before" picture for refreshIntakeForms. */
export async function intakeFormsBefore(tx: Tx, versionId: string) {
  return intakeForms(tx, versionId);
}

export async function saveIntakeSection(input: {
  protocolId: string;
  userId: string;
  section: IntakeSection;
  value: unknown;
  expectedRevision: number;
}): Promise<IntakeSaveSuccess | SaveConflict> {
  const parsed = SECTION_SCHEMA[input.section].safeParse(input.value);
  if (!parsed.success) throw new AppError("INVALID", parsed.error.issues[0]?.message ?? "Check the answers and try again.", 400);
  const meta = await auditRequestMeta({ section: input.section });
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const member = await proponentOn(tx, input.protocolId, input.userId);
    const version = await workingVersion(tx, input.protocolId);
    const created = await ensureIntake(tx, version.id);
    await tx.$queryRaw`SELECT id FROM protocol_intakes WHERE id = ${created.id} FOR UPDATE`;
    const intake = await tx.protocolIntake.findUniqueOrThrow({ where: { id: created.id } });
    const column = COLUMN[input.section];
    const sections = isRecord(intake.sectionRevisions) ? intake.sectionRevisions : {};
    const last = isRecord(sections[input.section]) ? (sections[input.section] as Record<string, unknown>) : null;
    if (intake.revision !== input.expectedRevision && last && typeof last.revision === "number" && last.revision > input.expectedRevision && last.userId !== input.userId) {
      const by = typeof last.userId === "string" ? await tx.user.findUnique({ where: { id: last.userId }, select: { id: true, displayName: true } }) : null;
      return {
        ok: false,
        code: "CONFLICT",
        revision: intake.revision,
        value: intake[column] ?? null,
        changedBy: by ? { id: by.id, name: by.displayName } : null,
        changedAt: typeof last.at === "string" ? last.at : null,
      } satisfies SaveConflict;
    }
    const before = await intakeForms(tx, version.id);
    const revision = intake.revision + 1;
    const at = new Date();
    await tx.protocolIntake.update({
      where: { id: intake.id },
      data: {
        [column]: toJson(parsed.data),
        revision,
        sectionRevisions: toJson({ ...sections, [input.section]: { revision, userId: input.userId, at: at.toISOString() } }),
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: member.isLeader ? "PROJECT_LEADER" : "PROPONENT",
      action: AuditAction.intakeSaved,
      entityType: "protocol_intake",
      entityId: intake.id,
      protocolId: input.protocolId,
      diff: diffOf({ [input.section]: intake[column] ?? null }, { [input.section]: parsed.data }),
      meta,
    });
    const voided = await refreshIntakeForms(tx, { versionId: version.id, before, protocolId: input.protocolId, actorUserId: input.userId, meta });
    return { ok: true, revision, data: { [input.section]: parsed.data }, writtenPaths: [input.section], signaturesVoided: voided > 0 };
  });
}

/**
 * A researcher agrees to (or withdraws from) the F-27 declarations or the F-28 consents. Each
 * researcher answers for themself. Withdrawing voids that researcher's signature on the form.
 */
export async function setAgreement(input: { protocolId: string; userId: string; kind: IntakeAgreementKind; agreed: boolean }) {
  const meta = await auditRequestMeta({ kind: input.kind });
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const member = await proponentOn(tx, input.protocolId, input.userId);
    const version = await workingVersion(tx, input.protocolId);
    const intake = await ensureIntake(tx, version.id);
    const existing = await tx.intakeAgreement.findUnique({
      where: { intakeId_memberId_kind: { intakeId: intake.id, memberId: member.id, kind: input.kind } },
    });
    if (input.agreed === Boolean(existing)) return { agreed: input.agreed };
    const now = new Date();
    if (input.agreed) {
      await tx.intakeAgreement.create({ data: { intakeId: intake.id, memberId: member.id, kind: input.kind, agreedAt: now } });
    } else if (existing) {
      if (existing.signatureEventId) {
        const event = await tx.signatureEvent.findUnique({ where: { id: existing.signatureEventId } });
        if (event && !event.voidedAt) {
          await tx.signatureEvent.update({ where: { id: event.id }, data: { voidedAt: now, voidReason: "AGREEMENT_WITHDRAWN" } });
          await audit.record(tx, {
            actorUserId: input.userId,
            action: AuditAction.signatureVoided,
            entityType: "signature_event",
            entityId: event.id,
            protocolId: input.protocolId,
            diff: diffOf({ voidedAt: null }, { voidedAt: now.toISOString(), voidReason: "AGREEMENT_WITHDRAWN", fieldPath: event.fieldPath }),
            meta,
          });
        }
      }
      await tx.intakeAgreement.delete({ where: { id: existing.id } });
    }
    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: member.isLeader ? "PROJECT_LEADER" : "PROPONENT",
      action: input.agreed ? AuditAction.intakeAgreed : AuditAction.intakeAgreementWithdrawn,
      entityType: "protocol_intake",
      entityId: intake.id,
      protocolId: input.protocolId,
      diff: diffOf({ [input.kind]: existing?.agreedAt.toISOString() ?? null }, { [input.kind]: input.agreed ? now.toISOString() : null }),
      meta,
    });
    return { agreed: input.agreed };
  });
}

export type IntakeView = {
  protocolId: string;
  versionId: string | null;
  versionNumber: number | null;
  editable: boolean;
  revision: number;
  values: IntakeValues;
  /** The current user's own agreements. */
  mine: { memberId: string | null; declarationsAt: string | null; consentsAt: string | null };
  researchers: { memberId: string; name: string; declarationsAt: string | null; consentsAt: string | null }[];
};

export async function readIntakeView(protocolId: string, userId: string): Promise<IntakeView> {
  const versions = await prisma.protocolVersion.findMany({
    where: { protocolId },
    orderBy: { number: "desc" },
    take: 1,
    include: { intake: { include: { agreements: true } } },
  });
  const version = versions[0] ?? null;
  const member = await prisma.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
  const members = await prisma.protocolMember.findMany({
    where: { protocolId, role: "PROPONENT", status: "ACTIVE", userId: { not: null } },
    include: { user: { select: { displayName: true } } },
    orderBy: [{ rosterOrder: "asc" }, { createdAt: "asc" }],
  });
  const agreements = version?.intake?.agreements ?? [];
  const at = (memberId: string, kind: IntakeAgreementKind) =>
    agreements.find((item) => item.memberId === memberId && item.kind === kind)?.agreedAt.toISOString() ?? null;
  return {
    protocolId,
    versionId: version?.id ?? null,
    versionNumber: version?.number ?? null,
    editable: Boolean(version && version.state === "WORKING" && member?.role === "PROPONENT"),
    revision: version?.intake?.revision ?? 0,
    values: readIntake(version?.intake ?? null),
    mine: {
      memberId: member?.id ?? null,
      declarationsAt: member ? at(member.id, "DECLARATIONS") : null,
      consentsAt: member ? at(member.id, "F28_CONSENT") : null,
    },
    researchers: members.map((item) => ({
      memberId: item.id,
      name: item.user?.displayName ?? "",
      declarationsAt: at(item.id, "DECLARATIONS"),
      consentsAt: at(item.id, "F28_CONSENT"),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
