import "server-only";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AuditAction } from "@/lib/audit-log";
import { fillDocx } from "@/lib/docs/fill-docx";
import { officialFormFileName, defaultFileNameSetting } from "@/lib/docs/names";
import { placeholderMapSchema } from "@/lib/docs/tags";
import { buildRenderModel } from "@/lib/docs/view";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { convertDocxToPdf } from "@/server/docs/pdf";
import { renderFormDocument } from "@/server/docs/render";
import { sharedSnapshot } from "@/server/protocols/snapshot";
import { getObjectBytes, putObject } from "@/server/storage";

export const CERTIFICATE_WARNING =
  "Certificate of Approval was not attached. Its template is not in the system yet.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function actorId(protocolId: string, instanceId: string, stepKey: string): Promise<string> {
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  if (task?.completedById) return task.completedById;
  const leader = await prisma.protocolMember.findFirst({
    where: { protocolId, role: "PROPONENT", isLeader: true, status: "ACTIVE" },
  });
  if (leader?.userId) return leader.userId;
  throw new AppError("NOT_FOUND", "No one is available to store the generated letter.", 404);
}

async function decisionOf(instanceId: string, protocolVersionId: string): Promise<string> {
  const letter = await prisma.formInstance.findFirst({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: protocolVersionId,
      formDefinition: { code: "F-39" },
    },
    orderBy: { createdAt: "desc" },
  });
  if (isRecord(letter?.data) && typeof letter.data.decision === "string") return letter.data.decision;
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey: { in: ["chair_decide", "chair_finalize"] }, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  return task?.outcome ?? "";
}

async function certificateReady(code: string): Promise<boolean> {
  const definition = await prisma.formDefinition.findFirst({
    where: { code, status: "PUBLISHED", templateFileId: { not: null } },
  });
  if (definition) return true;
  try {
    await access(join(process.cwd(), "templates", `${code}.docx`));
    return true;
  } catch {
    return false;
  }
}

async function warnMissingCertificate(instanceId: string, stepKey: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  if (!task || task.comment?.includes(CERTIFICATE_WARNING)) return;
  await prisma.task.update({
    where: { id: task.id },
    data: { comment: task.comment ? `${task.comment}\n${CERTIFICATE_WARNING}` : CERTIFICATE_WARNING },
  });
}

export async function generateDecisionDocuments(payload: unknown): Promise<void> {
  if (!isRecord(payload) || typeof payload.protocolId !== "string" || typeof payload.instanceId !== "string") {
    throw new AppError("INVALID", "The document job is missing its protocol.", 400);
  }
  const protocolId = payload.protocolId;
  const instanceId = payload.instanceId;
  const stepKey = typeof payload.stepKey === "string" ? payload.stepKey : "";
  const forms = Array.isArray(payload.forms) ? payload.forms.filter((item): item is string => typeof item === "string") : ["F-39"];
  const certificate = typeof payload.certificate === "string" ? payload.certificate : "COA";
  const workflow = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { protocolVersionId: true },
  });
  if (!workflow) throw new AppError("NOT_FOUND", "That workflow was not found.", 404);
  const userId = await actorId(protocolId, instanceId, stepKey);
  const instances = await prisma.formInstance.findMany({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: workflow.protocolVersionId,
      formDefinition: { code: { in: forms } },
    },
  });
  for (const instance of instances) {
    await renderFormDocument({ instanceId: instance.id, format: "docx", userId });
    await renderFormDocument({ instanceId: instance.id, format: "pdf", userId });
  }
  const decision = await decisionOf(instanceId, workflow.protocolVersionId);
  if (decision !== "APPROVED") return;
  if (!(await certificateReady(certificate))) {
    await warnMissingCertificate(instanceId, stepKey);
    return;
  }
  await renderCertificate({
    code: certificate,
    protocolId,
    protocolVersionId: workflow.protocolVersionId,
    userId,
  });
}

async function renderCertificate(input: {
  code: string;
  protocolId: string;
  protocolVersionId: string;
  userId: string;
}): Promise<void> {
  const existing = await prisma.storedFile.findFirst({
    where: { protocolVersionId: input.protocolVersionId, kind: "GENERATED_PDF", originalName: { contains: "Certificate of Approval" } },
  });
  if (existing) return;
  const definition = await prisma.formDefinition.findFirst({
    where: { code: input.code, templateFileId: { not: null } },
    orderBy: { publishedAt: "desc" },
  });
  let template: Buffer;
  let map = placeholderMapSchema.parse({});
  if (definition?.templateFileId) {
    const file = await prisma.storedFile.findUnique({ where: { id: definition.templateFileId } });
    if (!file) return;
    const object = await getObjectBytes(file.storageKey);
    template = Buffer.from(object.body);
    const parsed = placeholderMapSchema.safeParse(definition.placeholderMap);
    if (parsed.success) map = parsed.data;
  } else {
    template = await readFile(join(process.cwd(), "templates", `${input.code}.docx`));
  }
  const version = await prisma.protocolVersion.findUnique({
    where: { id: input.protocolVersionId },
    include: { protocol: { include: { members: { include: { user: true, contactEmail: true } } } } },
  });
  if (!version) return;
  const bound = {
    ...(version.state === "SUBMITTED" && isRecord(version.snapshot)
      ? version.snapshot
      : sharedSnapshot(version.protocol, version.label, version.submittedAt)),
    "rec.chairName": "",
  };
  const model = buildRenderModel({
    map,
    data: {},
    bound: { ...PREVIEW_BOUND_VALUES, ...bound },
    signatures: [],
  });
  const docx = fillDocx(template, model.data, model.images);
  const pdf = Buffer.from(await convertDocxToPdf(docx));
  const fileName = officialFormFileName(defaultFileNameSetting(), input.code, "pdf");
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const storageKey = `generated/certificate/${input.protocolVersionId}/${sha256}`;
  await putObject(storageKey, pdf, "application/pdf");
  const meta = await auditRequestMeta({ storageKey });
  await prisma.$transaction(async (tx) => {
    const created = await tx.storedFile.create({
      data: {
        protocolVersionId: input.protocolVersionId,
        kind: "GENERATED_PDF",
        originalName: fileName,
        suggestedName: fileName,
        storageKey,
        mime: "application/pdf",
        size: pdf.length,
        sha256,
        uploadedById: input.userId,
        scanStatus: "CLEAN",
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileUploaded,
      entityType: "file",
      entityId: created.id,
      protocolId: input.protocolId,
      diff: diffOf({}, { kind: "GENERATED_PDF", originalName: fileName }),
      meta,
    });
  });
}
