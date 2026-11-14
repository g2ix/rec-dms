import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AuditAction } from "@/lib/audit-log";
import { generatedFileWhere } from "@/lib/docs/cache";
import { fillDocx } from "@/lib/docs/fill-docx";
import { defaultFileNameSetting, officialFormFileName, type FileNameSetting } from "@/lib/docs/names";
import { placeholderMapSchema, type PlaceholderMap } from "@/lib/docs/tags";
import { buildRenderModel, type RenderOptions, type SignatureRender } from "@/lib/docs/view";
import { dataForRoles, hiddenForRoles, signatureHidden } from "@/lib/forms/role-view";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { env } from "@/lib/env";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { convertDocxToPdf } from "@/server/docs/pdf";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { getObjectBytes, putObject } from "@/server/storage";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

export type RenderedDocument = {
  fileId: string;
  bytes: Buffer;
  fileName: string;
  mime: string;
  protocolId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fileNameSetting(): Promise<FileNameSetting> {
  const row = await prisma.setting.findUnique({ where: { key: "docs.fileNamePattern" } });
  if (!isRecord(row?.value)) return defaultFileNameSetting();
  const setting = defaultFileNameSetting();
  for (const [key, value] of Object.entries(row.value)) {
    if (typeof value === "string" && value.trim()) setting[key] = value;
  }
  return setting;
}

async function chairName(): Promise<string> {
  const grant = await prisma.userRole.findFirst({
    where: { revokedAt: null, role: { key: "REC_CHAIR" } },
    include: { user: true },
    orderBy: { grantedAt: "asc" },
  });
  return grant?.user.displayName || grant?.user.name || "";
}

async function boundValuesFor(versionId: string | null): Promise<Record<string, unknown>> {
  const chair = await chairName();
  if (!versionId) return { ...PREVIEW_BOUND_VALUES, "rec.chairName": chair };
  const values = await versionBoundValues(prisma, versionId);
  if (Object.keys(values).length === 0) return { ...PREVIEW_BOUND_VALUES, "rec.chairName": chair };
  return { ...values, "rec.chairName": chair };
}

async function loadMap(code: string, stored: unknown): Promise<PlaceholderMap> {
  const parsed = placeholderMapSchema.safeParse(stored);
  if (parsed.success && Object.keys(parsed.data).length > 0) return parsed.data;
  const raw = await readFile(join(process.cwd(), "templates", "maps", `${code}.json`), "utf8");
  return placeholderMapSchema.parse(JSON.parse(raw));
}

async function templateBytes(code: string, templateFileId: string | null): Promise<Buffer> {
  if (templateFileId) {
    const file = await prisma.storedFile.findUnique({ where: { id: templateFileId } });
    if (file) {
      const object = await getObjectBytes(file.storageKey);
      return Buffer.from(object.body);
    }
  }
  try {
    return await readFile(join(process.cwd(), "templates", `${code}.docx`));
  } catch {
    throw new AppError("NOT_FOUND", "This form has no template yet.", 404);
  }
}

async function signatureRenders(instanceId: string): Promise<SignatureRender[]> {
  const events = await prisma.signatureEvent.findMany({
    where: { formInstanceId: instanceId, voidedAt: null },
    include: { user: true, signature: true },
    orderBy: { signedAt: "asc" },
  });
  const rendered: SignatureRender[] = [];
  for (const event of events) {
    let image: Buffer | null = null;
    try {
      const object = await getObjectBytes(event.signature.imageKey);
      image = Buffer.from(object.body);
    } catch {
      image = null;
    }
    rendered.push({
      fieldPath: event.fieldPath,
      signerName: event.user.displayName || event.user.name || "Signer",
      signedAt: event.signedAt,
      verifyRef: event.verifyRef,
      image,
    });
  }
  return rendered;
}

async function storeGenerated(input: {
  instanceId: string;
  protocolVersionId: string | null;
  protocolId: string | null;
  revision: number;
  kind: "GENERATED_DOCX" | "GENERATED_PDF";
  fileName: string;
  mime: string;
  bytes: Buffer;
  userId: string;
  variant?: string | null;
  audience?: string | null;
}): Promise<string> {
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const storageKey = `generated/${input.instanceId}/${input.kind}/${input.revision}/${input.variant ? `${input.variant}/` : ""}${sha256}`;
  await putObject(storageKey, input.bytes, input.mime);
  const meta = await auditRequestMeta({ storageKey, formInstanceId: input.instanceId });
  const file = await prisma.$transaction(async (tx) => {
    const created = await tx.storedFile.create({
      data: {
        protocolVersionId: input.protocolVersionId,
        formInstanceId: input.instanceId,
        sourceRevision: input.revision,
        kind: input.kind,
        originalName: input.fileName,
        suggestedName: input.fileName,
        storageKey,
        mime: input.mime,
        size: input.bytes.length,
        sha256,
        uploadedById: input.userId,
        scanStatus: "CLEAN",
        variant: input.variant ?? null,
        audience: input.audience ?? null,
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileUploaded,
      entityType: "file",
      entityId: created.id,
      protocolId: input.protocolId,
      diff: diffOf({}, { kind: input.kind, originalName: input.fileName, sha256, size: input.bytes.length, variant: input.variant ?? null, audience: input.audience ?? null }),
      meta,
    });
    return created;
  });
  return file.id;
}

/** The variant of a proponent-side download (see `renderFormDocument` `view`). */
export const PROPONENT_VIEW_VARIANT = "proponent-view";
/** The roles a proponent-side download is rendered for. */
export const PROPONENT_SIDE_ROLES = ["PROPONENT", "PROJECT_LEADER", "ADVISER"] as const;

export async function cachedGeneratedPdf(instanceId: string, variant: string | null = null): Promise<boolean> {
  const instance = await prisma.formInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, status: true, revision: true },
  });
  if (!instance) return false;
  const cached = await prisma.storedFile.findFirst({
    where: {
      formInstanceId: instance.id,
      variant,
      ...generatedFileWhere({ status: instance.status, revision: instance.revision, kind: "GENERATED_PDF" }),
    },
    select: { id: true },
  });
  return Boolean(cached);
}

export async function renderFormDocument(input: {
  instanceId: string;
  format: "docx" | "pdf";
  userId: string;
  /** A named copy kept apart from the plain render, such as "release" for a redacted copy. */
  variant?: string | null;
  options?: RenderOptions;
  /** PROPONENT or STAFF. STAFF copies are hidden from proponents and advisers. */
  audience?: string | null;
  /** Extra bound values, such as the signer of the step that released the document. */
  extraBound?: Record<string, unknown>;
  /**
   * "proponent": the copy a proponent or adviser may download. Fields and columns hidden from their
   * roles (reviewer columns, names, recommended action) are left out, as on the page. Kept apart
   * from the plain render as its own variant.
   */
  view?: "proponent";
}): Promise<RenderedDocument> {
  const variant = input.view === "proponent" ? PROPONENT_VIEW_VARIANT : input.variant ?? null;
  const instance = await prisma.formInstance.findUnique({
    where: { id: input.instanceId },
    include: { formDefinition: true },
  });
  if (!instance) throw new AppError("NOT_FOUND", "That form was not found.", 404);
  const kind = input.format === "pdf" ? "GENERATED_PDF" : "GENERATED_DOCX";
  const cached = await prisma.storedFile.findFirst({
    where: {
      formInstanceId: instance.id,
      variant,
      ...generatedFileWhere({ status: instance.status, revision: instance.revision, kind }),
    },
    orderBy: { createdAt: "asc" },
  });
  const setting = await fileNameSetting();
  const fileName = officialFormFileName(setting, instance.formDefinition.code, input.format);
  const protocol = await protocolOf(instance.ownerType, instance.ownerId);
  if (cached) {
    const object = await getObjectBytes(cached.storageKey);
    return {
      fileId: cached.id,
      bytes: Buffer.from(object.body),
      fileName: cached.suggestedName || cached.originalName,
      mime: cached.mime,
      protocolId: protocol?.protocolId ?? null,
    };
  }
  const check = validateSchema(instance.formDefinition.schema);
  const schema: FormSchema | undefined = check.ok ? check.schema : undefined;
  const map = await loadMap(instance.formDefinition.code, instance.formDefinition.placeholderMap);
  const bound = { ...(await boundValuesFor(protocol?.versionId ?? null)), ...(input.extraBound ?? {}) };
  // An intake-sourced form prints the intake and the Details page in its proponent fields.
  const effective = await effectiveFormData(prisma, instance, bound);
  const hidden = input.view === "proponent" && schema ? hiddenForRoles(schema, PROPONENT_SIDE_ROLES) : null;
  const data = hidden && schema ? dataForRoles(schema, effective, PROPONENT_SIDE_ROLES) : effective;
  const signatures = (await signatureRenders(instance.id)).filter((item) => !hidden || !signatureHidden(item.fieldPath, hidden));
  const model = buildRenderModel({
    map,
    data,
    bound,
    signatures,
    schema,
    timeZone: env.APP_TIMEZONE,
    options: input.options,
  });
  const template = await templateBytes(instance.formDefinition.code, instance.formDefinition.templateFileId);
  const docx = fillDocx(template, model.data, model.images);
  const bytes = input.format === "pdf" ? Buffer.from(await convertDocxToPdf(docx)) : docx;
  const mime = input.format === "pdf" ? PDF_MIME : DOCX_MIME;
  const fileId = await storeGenerated({
    instanceId: instance.id,
    protocolVersionId: protocol?.versionId ?? null,
    protocolId: protocol?.protocolId ?? null,
    revision: instance.revision,
    kind,
    fileName,
    mime,
    bytes,
    userId: input.userId,
    variant,
    audience: input.audience ?? null,
  });
  return { fileId, bytes, fileName, mime, protocolId: protocol?.protocolId ?? null };
}

async function protocolOf(
  ownerType: string,
  ownerId: string,
): Promise<{ protocolId: string; versionId: string } | null> {
  if (ownerType !== "PROTOCOL_VERSION") return null;
  const version = await prisma.protocolVersion.findUnique({
    where: { id: ownerId },
    select: { id: true, protocolId: true },
  });
  if (!version) return null;
  return { protocolId: version.protocolId, versionId: version.id };
}

export async function recordDocumentDownload(input: {
  fileId: string;
  userId: string;
  protocolId: string | null;
  fileName: string;
}): Promise<void> {
  const meta = await auditRequestMeta({ fileId: input.fileId });
  await prisma.$transaction(async (tx) => {
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileDownloaded,
      entityType: "file",
      entityId: input.fileId,
      protocolId: input.protocolId,
      diff: diffOf({}, { originalName: input.fileName }),
      meta,
    });
  });
}

/**
 * What a proponent or adviser may download for a form on a released protocol. A form generated
 * with a release audience is controlled: they get the PROPONENT copy, and a STAFF-only form is
 * refused. A form never released that way keeps the earlier rules (null).
 */
export async function proponentCopyOf(instanceId: string, format: "docx" | "pdf") {
  const controlled = await prisma.storedFile.findMany({
    where: { formInstanceId: instanceId, audience: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (controlled.length === 0) return null;
  const kind = format === "pdf" ? "GENERATED_PDF" : "GENERATED_DOCX";
  const copy = controlled.find((file) => file.audience === "PROPONENT" && file.kind === kind) ?? null;
  return { allowed: Boolean(copy), file: copy };
}
