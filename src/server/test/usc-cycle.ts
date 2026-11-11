import { eachField, findField, validateSchema, type FormSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { canSignSlot, signatureSlots, type RosterMember } from "@/lib/signatures/target";
import { prisma } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { toRoster } from "@/server/signatures/sign";
import { completeTask, type CompleteInput } from "@/server/workflow/engine";

/** Test helpers that walk the seeded USC REC workflows as each role would: fill, sign, complete. */

export async function grant(userId: string, key: string, panelId: string | null = null, attributes: Record<string, unknown> = {}) {
  const role = await prisma.role.upsert({ where: { key }, update: {}, create: { key, name: key, scope: panelId ? "PANEL" : "GLOBAL" } });
  await prisma.userRole.create({ data: { userId, roleId: role.id, panelId, attributes: toJson(attributes) } });
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  return {};
}

function blank(type: string, value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "boolean") return false;
  if (Array.isArray(value)) return value.length === 0;
  if (type === "yesNoNa" && typeof value === "object") {
    const choice = (value as { choice?: unknown }).choice;
    return choice !== "YES" && choice !== "NO" && choice !== "NA";
  }
  return false;
}

function sample(type: string, options?: { value: string }[]): unknown {
  if (type === "money" || type === "number") return 10000;
  if (type === "date") return "2027-01-06";
  if (type === "declaration" || type === "checkbox") return true;
  if (type === "yesNoNa") return { choice: "YES", reason: "" };
  if (type === "radio" || type === "select") return options?.[0]?.value ?? "YES";
  if (type === "checkboxes") return options?.[0] ? [options[0].value] : [];
  return "Page 1, line 1";
}

function rowShown(field: { showRowsWhenFilled?: string[] }, cells: Record<string, unknown>): boolean {
  const keys = field.showRowsWhenFilled;
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => {
    const value = cells[key];
    if (typeof value === "boolean") return value === true;
    return typeof value === "string" && value.trim() !== "";
  });
}

function canFill(fillers: string[] | undefined, steps: string[] | undefined, roles: string[], stepKey: string): boolean {
  if (steps && steps.length > 0 && !steps.includes(stepKey)) return false;
  if (fillers && fillers.length > 0 && !fillers.some((role) => roles.includes(role))) return false;
  return true;
}

function fillSchema(schema: FormSchema, current: Record<string, unknown>, stepKey: string, roles: string[], overrides: Record<string, unknown>) {
  const data = { ...current };
  for (const field of eachField(schema)) {
    if (field.type === "staticText" || field.type === "computed" || field.type === "signature" || field.bind) continue;
    if (field.type === "assessmentTable") {
      if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
      const table = record(data[field.id]);
      for (const row of field.rows ?? []) {
        const cells = record(table[row.id]);
        if (!rowShown(field, cells)) continue;
        for (const column of field.columns ?? []) {
          if (column.type === "computed") continue;
          if (!canFill(column.fillers, column.editableInSteps ?? field.editableInSteps, roles, stepKey)) continue;
          if (!blank(column.type, cells[column.id])) continue;
          cells[column.id] = sample(column.type, column.options);
        }
        table[row.id] = cells;
      }
      data[field.id] = table;
      continue;
    }
    if (field.type === "repeatingTable") {
      if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
      const rows = Array.isArray(data[field.id]) ? (data[field.id] as Record<string, unknown>[]) : [];
      if (rows.length > 0 || !field.validation?.required) continue;
      const row: Record<string, unknown> = {};
      for (const column of field.columns ?? []) {
        if (column.type === "computed") continue;
        row[column.id] = sample(column.type, column.options);
      }
      data[field.id] = [row];
      continue;
    }
    if (!canFill(field.fillers, field.editableInSteps, roles, stepKey)) continue;
    if (!blank(field.type, data[field.id])) continue;
    data[field.id] = sample(field.type, field.options);
  }
  return { ...data, ...overrides };
}

async function roster(protocolId: string): Promise<RosterMember[]> {
  return toRoster(
    await prisma.protocolMember.findMany({
      where: { protocolId, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { displayName: true } } },
    }),
  );
}

export async function signatureIdFor(userId: string): Promise<string> {
  const existing = await prisma.signature.findFirst({ where: { userId, active: true } });
  if (existing) return existing.id;
  const created = await prisma.signature.create({ data: { userId, imageKey: `signatures/test/${userId}.png`, method: "UPLOADED", active: true } });
  return created.id;
}

/** Records one signature on a field path, as the signing screen does. */
export async function sign(formInstanceId: string, fieldPath: string, userId: string, versionId: string) {
  await prisma.signatureEvent.create({
    data: {
      formInstanceId,
      fieldPath,
      userId,
      signatureId: await signatureIdFor(userId),
      dataHash: "seeded",
      protocolVersionId: versionId,
      signedAt: new Date(),
      verifyRef: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
    },
  });
}

/** The form instance a person works on: their own copy when `memberId` is given, else the shared one. */
export async function formOn(versionId: string, code: string, memberId: string | null = null) {
  const instance = await prisma.formInstance.findFirst({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: memberId, formDefinition: { code, status: "PUBLISHED" } },
    include: { formDefinition: true },
  });
  if (!instance) throw new Error(`Form ${code} is not open on this version.`);
  return instance;
}

/**
 * Fills every blank cell the roles may edit on this step, checks the form as the server does, and
 * signs each required slot of this step the person may sign.
 */
export async function writeForm(input: {
  versionId: string;
  protocolId: string;
  code: string;
  stepKey: string;
  roles: string[];
  userId: string;
  memberId?: string | null;
  overrides?: Record<string, unknown>;
}) {
  const instance = await formOn(input.versionId, input.code, input.memberId ?? null);
  const check = validateSchema(instance.formDefinition.schema);
  if (!check.ok) throw new Error(check.issues[0]?.message ?? input.code);
  const data = fillSchema(check.schema, record(instance.data), input.stepKey, input.roles, input.overrides ?? {});
  const issues = validateInstance({ schema: check.schema }, data, { roles: input.roles, stepKey: input.stepKey });
  if (issues.length > 0) throw new Error(`${input.code}: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  await prisma.$transaction(async (tx) => {
    if (instance.status === "LOCKED") await tx.$executeRaw`SELECT set_config('recdms.form_review', 'on', true)`;
    await tx.formInstance.update({ where: { id: instance.id }, data: { data: data as never } });
  });
  const members = await roster(input.protocolId);
  const filler = input.memberId ? members.find((member) => member.userId === input.userId) : null;
  const signed = new Set(
    (await prisma.signatureEvent.findMany({ where: { formInstanceId: instance.id, voidedAt: null }, select: { fieldPath: true } })).map((event) => event.fieldPath),
  );
  for (const slot of signatureSlots(check.schema, members, { assigneeUserId: filler?.userId ?? null })) {
    if (!slot.required || signed.has(slot.fieldPath)) continue;
    const field = findField(check.schema, slot.fieldId);
    if (!field?.editableInSteps?.includes(input.stepKey)) continue;
    if (!canSignSlot(field, slot, { userId: input.userId, roles: input.roles })) continue;
    await sign(instance.id, slot.fieldPath, input.userId, input.versionId);
  }
  return instance;
}

export async function upload(versionId: string, userId: string, kind: "MANUSCRIPT" | "COVER_LETTER" | "FEE_RECEIPT") {
  await prisma.storedFile.create({
    data: {
      protocolVersionId: versionId,
      kind,
      originalName: `${kind.toLowerCase()}.pdf`,
      storageKey: `${kind}-${crypto.randomUUID()}`,
      mime: "application/pdf",
      size: 128,
      sha256: "abc",
      uploadedById: userId,
      scanStatus: "CLEAN",
    },
  });
}

export async function running(protocolId: string) {
  return prisma.workflowInstance.findFirstOrThrow({ where: { protocolId, status: "RUNNING" }, orderBy: { startedAt: "desc" } });
}

export async function openTask(instanceId: string, stepKey: string, userId?: string) {
  return prisma.task.findFirstOrThrow({
    where: {
      instanceId,
      stepKey,
      kind: "MAIN",
      status: { in: ["OPEN", "CLAIMED"] },
      ...(userId ? { OR: [{ assigneeUserId: userId }, { assigneeUserId: null }] } : {}),
    },
  });
}

/** Completes the open main task of a step for this person (claiming a role task on the way). */
export async function finish(instanceId: string, stepKey: string, userId: string, input: CompleteInput = {}) {
  const task = await openTask(instanceId, stepKey, userId);
  return completeTask(task.id, userId, input);
}
