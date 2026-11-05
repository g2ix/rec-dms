import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuditAction } from "@/lib/audit-log";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { formatManila } from "@/lib/time";
import { SAMPLE_FORM_CODE, SAMPLE_FORM_TITLE, SAMPLE_FORM_VERSION, sampleFormSchema } from "@/lib/forms/sample";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";

const codeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/, "Use a short code such as F-27 or SAMPLE.");
const versionSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9./_-]{0,31}$/, "Use a version such as 09-00.");
const titleSchema = z.string().trim().min(1, "Enter a title.").max(200);
const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the effective date.");

export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dateToDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function uniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function requireValidSchema(input: unknown): FormSchema {
  const check = validateSchema(input);
  if (!check.ok) {
    throw new AppError("INVALID", check.issues[0]?.message ?? "The form schema is not valid.", 400);
  }
  return check.schema;
}

export async function listDefinitions() {
  return prisma.formDefinition.findMany({
    orderBy: [{ code: "asc" }, { version: "desc" }],
    include: { createdBy: { select: { displayName: true } } },
  });
}

export async function getDefinition(id: string) {
  const definition = await prisma.formDefinition.findUnique({
    where: { id },
    include: { createdBy: { select: { displayName: true } } },
  });
  if (!definition) throw new AppError("NOT_FOUND", "That form was not found.", 404);
  return definition;
}

export async function createDefinition(input: {
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  schema: unknown;
  userId: string;
}) {
  const code = codeSchema.parse(input.code);
  const title = titleSchema.parse(input.title);
  const version = versionSchema.parse(input.version);
  const effectiveDate = daySchema.parse(input.effectiveDate);
  const schema = requireValidSchema(input.schema);
  const meta = await auditRequestMeta({ code, version });
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.formDefinition.create({
        data: {
          code,
          title,
          version,
          effectiveDate: dayToDate(effectiveDate),
          schema: toJson(schema),
          createdById: input.userId,
        },
      });
      await audit.record(tx, {
        actorUserId: input.userId,
        action: AuditAction.definitionCreated,
        entityType: "form_definition",
        entityId: created.id,
        diff: diffOf({}, { code, title, version, status: "DRAFT" }),
        meta,
      });
      return created;
    });
  } catch (error) {
    if (uniqueConflict(error)) {
      throw new AppError("CONFLICT", `Version ${version} of ${code} already exists.`, 409);
    }
    throw error;
  }
}

export async function createSampleDefinition(userId: string) {
  const existing = await prisma.formDefinition.findUnique({
    where: { code_version: { code: SAMPLE_FORM_CODE, version: SAMPLE_FORM_VERSION } },
  });
  if (existing) return existing;
  const today = formatManila(new Date(), "yyyy-MM-dd");
  return createDefinition({
    code: SAMPLE_FORM_CODE,
    title: SAMPLE_FORM_TITLE,
    version: SAMPLE_FORM_VERSION,
    effectiveDate: today,
    schema: sampleFormSchema,
    userId,
  });
}

export async function updateDefinition(input: {
  id: string;
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  schema: unknown;
  userId: string;
}) {
  const current = await getDefinition(input.id);
  if (current.status !== "DRAFT") {
    throw new AppError("LOCKED", "Published definitions cannot be edited. Create a new version.", 409);
  }
  const code = codeSchema.parse(input.code);
  const title = titleSchema.parse(input.title);
  const version = versionSchema.parse(input.version);
  const effectiveDate = daySchema.parse(input.effectiveDate);
  const schema = requireValidSchema(input.schema);
  const meta = await auditRequestMeta({ code, version });
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.formDefinition.update({
        where: { id: current.id },
        data: {
          code,
          title,
          version,
          effectiveDate: dayToDate(effectiveDate),
          schema: toJson(schema),
        },
      });
      await audit.record(tx, {
        actorUserId: input.userId,
        action: AuditAction.definitionUpdated,
        entityType: "form_definition",
        entityId: updated.id,
        diff: diffOf(
          { code: current.code, title: current.title, version: current.version },
          { code, title, version },
        ),
        meta,
      });
      return updated;
    });
  } catch (error) {
    if (uniqueConflict(error)) {
      throw new AppError("CONFLICT", `Version ${version} of ${code} already exists.`, 409);
    }
    throw error;
  }
}

export async function publishDefinition(id: string, userId: string) {
  const current = await getDefinition(id);
  if (current.status !== "DRAFT") {
    throw new AppError("LOCKED", "Only a draft can be published.", 409);
  }
  requireValidSchema(current.schema);
  const meta = await auditRequestMeta({ code: current.code, version: current.version });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.formDefinition.update({
      where: { id: current.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.definitionPublished,
      entityType: "form_definition",
      entityId: updated.id,
      diff: diffOf({ status: "DRAFT" }, { status: "PUBLISHED" }),
      meta,
    });
    return updated;
  });
}

export async function retireDefinition(id: string, userId: string) {
  const current = await getDefinition(id);
  if (current.status === "RETIRED") {
    throw new AppError("LOCKED", "This version is already retired.", 409);
  }
  const meta = await auditRequestMeta({ code: current.code, version: current.version });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.formDefinition.update({
      where: { id: current.id },
      data: { status: "RETIRED" },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.definitionRetired,
      entityType: "form_definition",
      entityId: updated.id,
      diff: diffOf({ status: current.status }, { status: "RETIRED" }),
      meta,
    });
    return updated;
  });
}

export async function createVersion(id: string, version: string, userId: string) {
  const current = await getDefinition(id);
  const nextVersion = versionSchema.parse(version);
  requireValidSchema(current.schema);
  const meta = await auditRequestMeta({ code: current.code, version: nextVersion, from: current.version });
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.formDefinition.create({
        data: {
          code: current.code,
          title: current.title,
          version: nextVersion,
          effectiveDate: current.effectiveDate,
          schema: toJson(current.schema),
          templateFileId: current.templateFileId,
          ...(current.placeholderMap == null ? {} : { placeholderMap: toJson(current.placeholderMap) }),
          createdById: userId,
        },
      });
      await audit.record(tx, {
        actorUserId: userId,
        action: AuditAction.versionCreated,
        entityType: "form_definition",
        entityId: created.id,
        diff: diffOf({}, { code: current.code, version: nextVersion, copiedFrom: current.version }),
        meta,
      });
      return created;
    });
  } catch (error) {
    if (uniqueConflict(error)) {
      throw new AppError("CONFLICT", `Version ${nextVersion} of ${current.code} already exists.`, 409);
    }
    throw error;
  }
}
