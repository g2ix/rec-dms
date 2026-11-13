import "server-only";
import type { FormInstance, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { conflictResult, type SaveConflict } from "@/lib/forms/conflict";
import {
  canChangeRepeatingRows,
  getEditableFields,
  isRepeatingColumnEditable,
} from "@/lib/forms/editable";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { asDataRecord, getPath, setPath } from "@/lib/forms/paths";
import { recompute } from "@/lib/forms/recompute";
import { findField, validateSchema, type FormField, type FormSchema } from "@/lib/forms/schema";
import { validateCellValue, validateDraftValue, validateInstance, type FieldIssue } from "@/lib/forms/validate";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { loadAuthoredRows } from "@/server/forms/authored";
import { toJson, toJsonValue } from "@/server/forms/json";
import { voidSignaturesForDataChange } from "@/server/signatures/sign";
import { editingStepFor } from "@/server/workflow/access";

export type SaveSuccess = {
  ok: true;
  revision: number;
  data: Record<string, unknown>;
  writtenPaths: string[];
  signaturesVoided: boolean;
};

export type SaveFailure = { ok: false; code: string; message: string };
export type SaveFieldResult = SaveSuccess | SaveConflict | SaveFailure;

type CellTarget = { kind: "cell"; field: FormField; rowId: string; columnId: string };
type FieldTarget = { kind: "field"; field: FormField };
type Target = CellTarget | FieldTarget;

function checkedSchema(input: unknown): FormSchema {
  const check = validateSchema(input);
  if (!check.ok) throw new AppError("INVALID", check.issues[0]?.message ?? "This form schema is not valid.", 400);
  return check.schema;
}

function cloneData(value: unknown): Record<string, unknown> {
  return asDataRecord(JSON.parse(JSON.stringify(value ?? {})) as unknown);
}

function resolveTarget(schema: FormSchema, path: string): Target | null {
  const parts = path.split(".");
  const field = findField(schema, parts[0] ?? "");
  if (!field) return null;
  if (parts.length === 1) return { kind: "field", field };
  if ((field.type === "assessmentTable" || field.type === "repeatingTable") && parts.length === 3) {
    const column = field.columns?.find((item) => item.id === parts[2]);
    if (!column) return null;
    if (field.type === "assessmentTable" && !field.rows?.some((row) => row.id === parts[1])) return null;
    return { kind: "cell", field, rowId: parts[1]!, columnId: column.id };
  }
  return null;
}

function applyValue(data: Record<string, unknown>, target: Target, path: string, value: unknown, editable: Set<string>): Record<string, unknown> {
  if (target.kind === "field" && target.field.type === "repeatingTable") {
    const merged = mergeRepeating(target.field, data[target.field.id], value, editable);
    return setPath(data, target.field.id, merged);
  }
  if (target.kind === "cell" && target.field.type === "repeatingTable") {
    return setPath(data, target.field.id, setRepeatingCell(data[target.field.id], target.rowId, target.columnId, value));
  }
  return setPath(data, path, value);
}

function mergeRepeating(field: FormField, previous: unknown, incoming: unknown, editable: Set<string>): Record<string, unknown>[] {
  if (!Array.isArray(incoming)) throw new AppError("INVALID", "Send the table rows.", 400);
  const columns = field.columns ?? [];
  const prevRows = Array.isArray(previous) ? previous.filter(isRow) : [];
  const prevById = new Map(prevRows.map((row) => [String(row._rowId ?? ""), row]));
  if (!canChangeRepeatingRows(editable, field.id)) {
    const incomingById = new Map(incoming.filter(isRow).map((row) => [String(row._rowId ?? ""), row]));
    return prevRows.map((row) => {
      const next = incomingById.get(String(row._rowId ?? ""));
      const merged: Record<string, unknown> = { ...row };
      if (!next) return merged;
      for (const column of columns) {
        if (isRepeatingColumnEditable(editable, field.id, column.id)) merged[column.id] = next[column.id] ?? null;
      }
      return merged;
    });
  }
  return incoming.map((row) => {
    if (!isRow(row)) throw new AppError("INVALID", "A row is missing its values.", 400);
    const id = typeof row._rowId === "string" && row._rowId ? row._rowId : crypto.randomUUID();
    const prev = prevById.get(id);
    const merged: Record<string, unknown> = { _rowId: id };
    for (const column of columns) {
      merged[column.id] = isRepeatingColumnEditable(editable, field.id, column.id)
        ? (row[column.id] ?? null)
        : (prev?.[column.id] ?? null);
    }
    return merged;
  });
}

function setRepeatingCell(previous: unknown, rowId: string, columnId: string, value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(previous) ? previous.filter(isRow).map((row) => ({ ...row })) : [];
  const index = rows.findIndex((row) => row._rowId === rowId);
  if (index < 0) throw new AppError("INVALID", "That row is no longer on the table.", 400);
  rows[index] = { ...rows[index], [columnId]: value ?? null };
  return rows;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertEditable(editable: Set<string>, target: Target, path: string): void {
  if (target.kind === "cell" && target.field.type === "repeatingTable") {
    if (!isRepeatingColumnEditable(editable, target.field.id, target.columnId)) {
      throw new AppError("FORBIDDEN", "You cannot edit that column in this role.", 403);
    }
    return;
  }
  if (target.kind === "field" && target.field.type === "repeatingTable") {
    if (!canChangeRepeatingRows(editable, target.field.id)) {
      throw new AppError("FORBIDDEN", "You cannot change the rows of that table in this role.", 403);
    }
    return;
  }
  if (!editable.has(path)) throw new AppError("FORBIDDEN", "You cannot edit that field in this role.", 403);
}

function assertDraftShape(target: Target, value: unknown, data: Record<string, unknown>, path: string): void {
  const issues =
    target.kind === "cell"
      ? validateCellValue(target.field, target.columnId, value, path)
      : validateDraftValue(target.field, target.kind === "field" && target.field.type === "repeatingTable" ? value : value, data, path);
  if (issues.length > 0) throw new AppError("INVALID", issues[0]!.message, 400);
}

async function protocolContext(
  tx: Prisma.TransactionClient,
  instance: FormInstance,
): Promise<{ protocolId: string | null; submitted: boolean }> {
  if (instance.ownerType !== "PROTOCOL_VERSION") return { protocolId: null, submitted: false };
  const version = await tx.protocolVersion.findUnique({
    where: { id: instance.ownerId },
    select: { protocolId: true, state: true },
  });
  return { protocolId: version?.protocolId ?? null, submitted: version?.state === "SUBMITTED" };
}

async function rolesFor(
  tx: Prisma.TransactionClient,
  instance: FormInstance,
  userId: string,
): Promise<{ roles: RoleKey[]; step: string | null }> {
  if (instance.ownerType === "SANDBOX") {
    return { roles: instance.previewRoles.filter(isRoleKey), step: instance.previewStep };
  }
  if (instance.ownerType === "PROTOCOL_VERSION") {
    const version = await tx.protocolVersion.findUnique({
      where: { id: instance.ownerId },
      select: { protocolId: true },
    });
    if (!version) return { roles: [], step: null };
    const [member, grants] = await Promise.all([
      tx.protocolMember.findFirst({
        where: { protocolId: version.protocolId, userId, status: "ACTIVE" },
      }),
      tx.userRole.findMany({
        where: { userId, revokedAt: null },
        select: { role: { select: { key: true } } },
      }),
    ]);
    const roles: RoleKey[] = [];
    if (member && isRoleKey(member.role)) roles.push(member.role);
    if (member?.isLeader) roles.push("PROJECT_LEADER");
    for (const grant of grants) {
      if (isRoleKey(grant.role.key) && !roles.includes(grant.role.key)) roles.push(grant.role.key);
    }
    return { roles, step: null };
  }
  const grants = await tx.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } } },
  });
  return { roles: grants.map((grant) => grant.role.key).filter(isRoleKey), step: null };
}

export async function saveField(input: {
  instanceId: string;
  path: string;
  value: unknown;
  expectedRevision: number;
  userId: string;
}): Promise<SaveSuccess | SaveConflict> {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)*$/.test(input.path)) {
    throw new AppError("INVALID", "That field path is not valid.", 400);
  }
  const meta = await auditRequestMeta({ path: input.path });
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    await tx.$queryRaw`SELECT id FROM form_instances WHERE id = ${input.instanceId} FOR UPDATE`;
    const instance = await tx.formInstance.findUnique({
      where: { id: input.instanceId },
      include: { formDefinition: true },
    });
    if (!instance) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
    const context = await protocolContext(tx, instance);

    if (instance.revision !== input.expectedRevision) {
      const touched = await tx.formFieldRevision.findFirst({
        where: {
          formInstanceId: instance.id,
          fieldPath: input.path,
          revision: { gt: input.expectedRevision },
        },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: { revision: "desc" },
      });
      if (touched) {
        const conflict = conflictResult(
          input.expectedRevision,
          instance.revision,
          getPath(instance.data, input.path),
          { id: touched.user.id, name: touched.user.displayName },
          touched.at,
        );
        if (conflict) return conflict;
      }
    }

    const openStep =
      instance.ownerType === "PROTOCOL_VERSION"
        ? await editingStepFor(tx, input.userId, instance.ownerId, instance.formDefinition.code)
        : null;
    const running =
      instance.ownerType === "PROTOCOL_VERSION"
        ? await tx.workflowInstance.findFirst({
            where: { protocolVersionId: instance.ownerId, status: "RUNNING" },
            select: { id: true },
          })
        : null;
    const reviewerPass = Boolean(openStep) && (instance.status === "DRAFT" || instance.status === "LOCKED");
    if (instance.status === "COMPLETE" || (instance.status === "LOCKED" && !reviewerPass) || (running && !openStep && !reviewerPass)) {
      throw new AppError(
        "LOCKED",
        instance.status === "LOCKED" || context.submitted
          ? "This version is submitted and cannot be edited."
          : "This form is complete and cannot be edited.",
        409,
      );
    }

    const schema = checkedSchema(instance.formDefinition.schema);
    const target = resolveTarget(schema, input.path);
    if (!target) throw new AppError("INVALID", "That field is not on this form.", 400);
    const { roles, step } = await rolesFor(tx, instance, input.userId);
    const allowedRows =
      instance.ownerType === "PROTOCOL_VERSION" ? await loadAuthoredRows(tx, input.userId, instance.ownerId, schema) : undefined;
    const editable = getEditableFields(
      { schema },
      { status: instance.status === "LOCKED" && reviewerPass ? "DRAFT" : instance.status, data: instance.data, filledByUserId: null },
      { id: input.userId },
      roles,
      openStep ?? step,
      allowedRows,
    );
    assertEditable(editable, target, input.path);

    const previous = cloneData(instance.data);
    const draftValue = target.kind === "field" && target.field.type === "repeatingTable" ? input.value : input.value;
    assertDraftShape(target, draftValue, previous, input.path);
    const written = applyValue(previous, target, input.path, input.value, editable);
    const computed = recompute(schema, written);
    const next = computed.data;
    const revision = instance.revision + 1;
    const writtenPaths = [input.path, ...computed.changed.filter((id) => id !== input.path)];
    const at = new Date();

    if (reviewerPass) await tx.$executeRaw`SELECT set_config('recdms.form_review', 'on', true)`;
    await tx.formInstance.update({
      where: { id: instance.id },
      data: { data: toJson(next), revision },
    });
    for (const fieldPath of writtenPaths) {
      await tx.formFieldRevision.create({
        data: {
          formInstanceId: instance.id,
          fieldPath,
          value: toJsonValue(getPath(next, fieldPath)),
          userId: input.userId,
          revision,
          at,
        },
      });
    }

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const fieldPath of writtenPaths) {
      before[fieldPath] = getPath(previous, fieldPath) ?? null;
      after[fieldPath] = getPath(next, fieldPath) ?? null;
    }
    await audit.record(tx, {
      actorUserId: input.userId,
      actingRole: roles[0] ?? null,
      action: AuditAction.fieldSaved,
      entityType: "form_instance",
      entityId: instance.id,
      protocolId: context.protocolId,
      diff: diffOf(before, after),
      meta,
    });

    const voided =
      target.kind === "field" && target.field.type === "signature"
        ? 0
        : await voidSignaturesForDataChange(tx, {
            instance,
            schema,
            before: previous,
            after: next,
            protocolId: context.protocolId,
            actorUserId: input.userId,
            meta,
          }).then((events) => events.length);

    return { ok: true, revision, data: next, writtenPaths, signaturesVoided: voided > 0 };
  });
}

export async function ensureSandbox(definitionId: string, userId: string) {
  const definition = await prisma.formDefinition.findUnique({ where: { id: definitionId } });
  if (!definition) throw new AppError("NOT_FOUND", "That form was not found.", 404);
  if (definition.status === "RETIRED") {
    throw new AppError("LOCKED", "Retired forms cannot be tried.", 409);
  }
  checkedSchema(definition.schema);
  const existing = await prisma.formInstance.findFirst({
    where: { formDefinitionId: definitionId, ownerType: "SANDBOX", ownerId: userId },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.formInstance.create({
    data: {
      formDefinitionId: definitionId,
      ownerType: "SANDBOX",
      ownerId: userId,
      data: {},
      previewRoles: ["PROPONENT"],
      status: "DRAFT",
    },
  });
}

export async function setSandboxPreview(input: { instanceId: string; roles: RoleKey[]; step: string | null; userId: string }) {
  const instance = await prisma.formInstance.findUnique({ where: { id: input.instanceId } });
  if (!instance || instance.ownerType !== "SANDBOX" || instance.ownerId !== input.userId) {
    throw new AppError("NOT_FOUND", "That sandbox was not found.", 404);
  }
  return prisma.formInstance.update({
    where: { id: instance.id },
    data: { previewRoles: input.roles, previewStep: input.step && input.step.trim() ? input.step.trim() : null },
  });
}

export async function markComplete(instanceId: string, userId: string): Promise<{ ok: true } | { ok: false; errors: FieldIssue[] }> {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    await tx.$queryRaw`SELECT id FROM form_instances WHERE id = ${instanceId} FOR UPDATE`;
    const instance = await tx.formInstance.findUnique({
      where: { id: instanceId },
      include: { formDefinition: true },
    });
    if (!instance || (instance.ownerType === "SANDBOX" && instance.ownerId !== userId)) {
      throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
    }
    if (instance.status !== "DRAFT") throw new AppError("LOCKED", "This form is already complete.", 409);
    const schema = checkedSchema(instance.formDefinition.schema);
    const data = recompute(schema, cloneData(instance.data)).data;
    const errors = validateInstance({ schema }, data);
    if (errors.length > 0) return { ok: false, errors };
    await tx.formInstance.update({
      where: { id: instance.id },
      data: { data: toJson(data), status: "COMPLETE" },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.markedComplete,
      entityType: "form_instance",
      entityId: instance.id,
      diff: diffOf({ status: "DRAFT" }, { status: "COMPLETE" }),
      meta,
    });
    return { ok: true };
  });
}

export async function reopenSandbox(instanceId: string, userId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const instance = await tx.formInstance.findUnique({ where: { id: instanceId } });
    if (!instance || instance.ownerType !== "SANDBOX" || instance.ownerId !== userId) {
      throw new AppError("NOT_FOUND", "That sandbox was not found.", 404);
    }
    await tx.formInstance.update({ where: { id: instance.id }, data: { status: "DRAFT" } });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.reopened,
      entityType: "form_instance",
      entityId: instance.id,
      diff: diffOf({ status: instance.status }, { status: "DRAFT" }),
      meta,
    });
  });
}
