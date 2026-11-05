import "server-only";
import type { FormInstance, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { formDataHash, signatureFieldIds } from "@/lib/signatures/hash";
import { randomVerifyRef } from "@/lib/signatures/ref";
import {
  canSignSlot,
  missingRequiredSignatures,
  slotByPath,
  type RosterMember,
  type SignatureMark,
} from "@/lib/signatures/target";
import { audit, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertFreshSigningStepUp } from "@/server/stepup";
import { editingStepFor } from "@/server/workflow/access";

type Tx = Prisma.TransactionClient;
type Meta = Prisma.InputJsonObject;

function checkedSchema(input: unknown): FormSchema {
  const check = validateSchema(input);
  if (!check.ok) throw new AppError("INVALID", check.issues[0]?.message ?? "This form schema is not valid.", 400);
  return check.schema;
}

export function toRoster(
  members: {
    userId: string | null;
    role: string;
    isLeader: boolean;
    rosterOrder: number;
    status: string;
    invitedEmail: string | null;
    user: { displayName: string } | null;
  }[],
): RosterMember[] {
  return members.map((member) => ({
    userId: member.userId,
    role: member.role,
    isLeader: member.isLeader,
    rosterOrder: member.rosterOrder,
    status: member.status,
    displayName: member.user?.displayName ?? member.invitedEmail ?? "Invited member",
  }));
}

function actorRoles(member: { role: string; isLeader: boolean } | null): RoleKey[] {
  if (!member) return [];
  const roles: RoleKey[] = [];
  if (isRoleKey(member.role)) roles.push(member.role);
  if (member.isLeader) roles.push("PROJECT_LEADER");
  return roles;
}

async function uniqueRef(tx: Tx): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const verifyRef = randomVerifyRef();
    const existing = await tx.signatureEvent.findUnique({ where: { verifyRef }, select: { id: true } });
    if (!existing) return verifyRef;
  }
  throw new AppError("INVALID", "Could not assign a signature reference. Try again.", 500);
}

export async function signField(input: {
  formInstanceId: string;
  fieldPath: string;
  userId: string;
  meta: Meta;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    await tx.$queryRaw`SELECT id FROM form_instances WHERE id = ${input.formInstanceId} FOR UPDATE`;
    const instance = await tx.formInstance.findUnique({
      where: { id: input.formInstanceId },
      include: { formDefinition: true },
    });
    if (!instance) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
    if (instance.ownerType !== "PROTOCOL_VERSION") {
      throw new AppError("INVALID", "Signatures are collected on a protocol form.", 400);
    }
    const version = await tx.protocolVersion.findUnique({ where: { id: instance.ownerId } });
    if (!version) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
    const openStep =
      version.state === "WORKING"
        ? null
        : await editingStepFor(tx, input.userId, version.id, instance.formDefinition.code);
    if (instance.status !== "DRAFT" || (version.state !== "WORKING" && !openStep)) {
      throw new AppError("LOCKED", "This version is submitted and cannot be signed.", 409);
    }

    await assertFreshSigningStepUp(tx, input.userId, now);
    const signature = await tx.signature.findFirst({
      where: { userId: input.userId, active: true },
      orderBy: { version: "desc" },
    });
    if (!signature) {
      throw new AppError("SIGNATURE_REQUIRED", "Save a signature image under My signature before signing.", 400);
    }

    const schema = checkedSchema(instance.formDefinition.schema);
    const members = toRoster(
      await tx.protocolMember.findMany({
        where: { protocolId: version.protocolId, status: { in: ["ACTIVE", "INVITED"] } },
        include: { user: { select: { displayName: true } } },
      }),
    );
    const target = slotByPath(schema, members, input.fieldPath);
    if (!target) throw new AppError("INVALID", "That signature is not on this form.", 400);
    const membership = await tx.protocolMember.findFirst({
      where: { protocolId: version.protocolId, userId: input.userId, status: "ACTIVE" },
    });
    if (
      !canSignSlot(target.field, target.slot, {
        userId: input.userId,
        roles: actorRoles(membership),
      })
    ) {
      throw new AppError("FORBIDDEN", "You cannot sign that field.", 403);
    }

    const current = await tx.signatureEvent.findFirst({
      where: { formInstanceId: instance.id, fieldPath: input.fieldPath, voidedAt: null },
    });
    if (current) throw new AppError("ALREADY_SIGNED", "This field is already signed.", 409);

    const dataHash = formDataHash(instance.data, signatureFieldIds(schema));
    const verifyRef = await uniqueRef(tx);
    const event = await tx.signatureEvent.create({
      data: {
        formInstanceId: instance.id,
        fieldPath: input.fieldPath,
        userId: input.userId,
        signatureId: signature.id,
        dataHash,
        protocolVersionId: version.id,
        signedAt: now,
        ip: typeof input.meta.ip === "string" ? input.meta.ip : null,
        userAgent: typeof input.meta.userAgent === "string" ? input.meta.userAgent : null,
        verifyRef,
        method: "IMAGE",
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: actorRoles(membership)[0] ?? null,
      action: AuditAction.formSigned,
      entityType: "signature_event",
      entityId: event.id,
      protocolId: version.protocolId,
      diff: diffOf({}, { fieldPath: input.fieldPath, verifyRef, signatureVersion: signature.version }),
      meta: input.meta,
    });
    return event;
  });
}

export async function voidSignaturesForDataChange(
  tx: Tx,
  input: {
    instance: FormInstance;
    schema: FormSchema;
    before: unknown;
    after: unknown;
    protocolId: string | null;
    actorUserId: string;
    meta: Meta;
  },
): Promise<number> {
  const ids = signatureFieldIds(input.schema);
  if (formDataHash(input.before, ids) === formDataHash(input.after, ids)) return 0;
  const events = await tx.signatureEvent.findMany({
    where: { formInstanceId: input.instance.id, voidedAt: null },
  });
  if (events.length === 0) return 0;
  const now = new Date();
  const definition = await tx.formDefinition.findUnique({
    where: { id: input.instance.formDefinitionId },
    select: { code: true },
  });
  const notified = new Set<string>();
  for (const event of events) {
    await tx.signatureEvent.update({
      where: { id: event.id },
      data: { voidedAt: now, voidReason: "DATA_CHANGED" },
    });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.signatureVoided,
      entityType: "signature_event",
      entityId: event.id,
      protocolId: input.protocolId,
      diff: diffOf({ voidedAt: null }, { voidedAt: now.toISOString(), voidReason: "DATA_CHANGED", fieldPath: event.fieldPath }),
      meta: input.meta,
    });
    if (notified.has(event.userId)) continue;
    notified.add(event.userId);
    await tx.notification.create({
      data: {
        userId: event.userId,
        type: "form.signature_voided",
        payload: {
          formInstanceId: input.instance.id,
          formCode: definition?.code ?? "",
          protocolId: input.protocolId,
          message: "A form you signed was edited. Your signature is void and needs to be signed again.",
        },
      },
    });
  }
  return events.length;
}

export async function signatureMarks(
  db: { signatureEvent: Tx["signatureEvent"] },
  instanceIds: string[],
): Promise<Map<string, SignatureMark[]>> {
  if (instanceIds.length === 0) return new Map();
  const events = await db.signatureEvent.findMany({
    where: { formInstanceId: { in: instanceIds } },
    select: { formInstanceId: true, fieldPath: true, voidedAt: true },
  });
  const grouped = new Map<string, SignatureMark[]>();
  for (const event of events) {
    const list = grouped.get(event.formInstanceId) ?? [];
    list.push({ fieldPath: event.fieldPath, voidedAt: event.voidedAt });
    grouped.set(event.formInstanceId, list);
  }
  return grouped;
}

export function formNeedsSignatures(schema: FormSchema, members: RosterMember[], events: SignatureMark[]): boolean {
  return missingRequiredSignatures(schema, members, events).length > 0;
}

export async function describeVerification(ref: string) {
  const event = await prisma.signatureEvent.findUnique({
    where: { verifyRef: ref },
    include: {
      user: { select: { displayName: true } },
      formInstance: { include: { formDefinition: { select: { code: true, schema: true } } } },
      protocolVersion: { include: { protocol: { select: { code: true } } } },
    },
  });
  if (!event) return null;
  const parsed = validateSchema(event.formInstance.formDefinition.schema);
  const ids = parsed.ok ? signatureFieldIds(parsed.schema) : [];
  const current = formDataHash(event.formInstance.data, ids);
  const matches = event.voidedAt == null && current === event.dataHash;
  return {
    formCode: event.formInstance.formDefinition.code,
    protocolCode: event.protocolVersion?.protocol.code ?? null,
    signerName: event.user.displayName,
    signedAt: event.signedAt,
    matches,
  };
}
