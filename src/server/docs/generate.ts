import "server-only";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AuditAction } from "@/lib/audit-log";
import { certificateDates, parsePeriod } from "@/lib/certificates";
import { fillDocx } from "@/lib/docs/fill-docx";
import { officialFormFileName, defaultFileNameSetting } from "@/lib/docs/names";
import { placeholderMapSchema } from "@/lib/docs/tags";
import { buildRenderModel } from "@/lib/docs/view";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import { manilaDay } from "@/lib/workflow/calendar";
import { parseGraph, releaseItemKey, type ReleaseItem, type Step } from "@/lib/workflow/graph";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";
import { convertDocxToPdf } from "@/server/docs/pdf";
import { renderFormDocument } from "@/server/docs/render";
import { sharedSnapshot } from "@/server/protocols/snapshot";
import { getObjectBytes, putObject } from "@/server/storage";

export const CERTIFICATE_WARNING =
  "Certificate of Approval was not attached. Its template is not in the system yet.";

const CERTIFICATE_PREFIX = "certificate:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function actorId(protocolId: string, instanceId: string, stepKey: string): Promise<string> {
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey, status: "COMPLETED", completedById: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  if (task?.completedById) return task.completedById;
  const leader = await prisma.protocolMember.findFirst({
    where: { protocolId, role: "PROPONENT", isLeader: true, status: "ACTIVE" },
  });
  if (leader?.userId) return leader.userId;
  throw new AppError("NOT_FOUND", "No one is available to store the generated letter.", 404);
}

async function decisionOf(instanceId: string, protocolVersionId: string, steps: Step[]): Promise<string> {
  const letter = await prisma.formInstance.findFirst({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: protocolVersionId,
      formDefinition: { code: "F-39" },
    },
    orderBy: { createdAt: "desc" },
  });
  if (isRecord(letter?.data) && typeof letter.data.decision === "string") return letter.data.decision;
  const legacy = await prisma.task.findFirst({
    where: { instanceId, stepKey: { in: ["chair_decide", "chair_finalize"] }, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  if (legacy?.outcome) return legacy.outcome;
  const decisionKeys = steps.filter((step) => step.type === "DECISION").map((step) => step.key);
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey: { in: decisionKeys }, status: "COMPLETED", outcome: { not: null } },
    orderBy: { completedAt: "desc" },
  });
  return task?.outcome ?? "";
}

/**
 * The person who signed the decision: whoever completed the latest named step (`signerFrom`),
 * or else the latest DECISION step whose assignee falls back through a chain.
 */
export async function decisionSigner(instanceId: string, steps: Step[], signerFrom: string[] = []): Promise<string | null> {
  const keys = signerFrom.length > 0 ? signerFrom : steps.filter((step) => step.type === "DECISION" && step.assignee?.kind === "FIRST_AVAILABLE").map((step) => step.key);
  if (keys.length === 0) return null;
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey: { in: keys }, status: "COMPLETED", completedById: { not: null } },
    orderBy: { completedAt: "desc" },
    include: { completedBy: { select: { displayName: true, name: true } } },
  });
  return task?.completedBy?.displayName || task?.completedBy?.name || null;
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

async function warnMissing(instanceId: string, stepKey: string, warning: string): Promise<void> {
  const task = await prisma.task.findFirst({
    where: { instanceId, stepKey, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
  });
  if (!task || task.comment?.includes(warning)) return;
  await prisma.task.update({
    where: { id: task.id },
    data: { comment: task.comment ? `${task.comment}\n${warning}` : warning },
  });
}

export async function generateDecisionDocuments(payload: unknown): Promise<void> {
  if (!isRecord(payload) || typeof payload.protocolId !== "string" || typeof payload.instanceId !== "string") {
    throw new AppError("INVALID", "The document job is missing its protocol.", 400);
  }
  const protocolId = payload.protocolId;
  const instanceId = payload.instanceId;
  const stepKey = typeof payload.stepKey === "string" ? payload.stepKey : "";
  const workflow = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    select: { protocolVersionId: true, version: { select: { graph: true } } },
  });
  if (!workflow) throw new AppError("NOT_FOUND", "That workflow was not found.", 404);
  const parsed = parseGraph(workflow.version.graph);
  const steps = parsed.ok ? parsed.graph.steps : [];
  const step = steps.find((item) => item.key === stepKey);
  const userId = await actorId(protocolId, instanceId, stepKey);
  const signerFrom = Array.isArray(payload.signerFrom) ? payload.signerFrom.filter((item): item is string => typeof item === "string") : [];
  const signer = await decisionSigner(instanceId, steps, signerFrom);
  // Certificate dates are bound for every released form, so a certificate kept as a signed form
  // (one the researchers sign back) prints the same dates as one rendered from a template alone.
  const extraBound: Record<string, unknown> = {
    ...(step?.release ? await certificateBound(workflow.protocolVersionId) : {}),
    ...(signer ? { "rec.signerName": signer, "rec.chairName": signer } : {}),
  };
  const decision = await decisionOf(instanceId, workflow.protocolVersionId, steps);

  if (step?.release) {
    const pack = step.release[decision] ?? step.release["*"];
    if (!pack) return;
    for (const item of pack.send ?? []) {
      await releaseItem({ item, audience: "PROPONENT", protocolId, protocolVersionId: workflow.protocolVersionId, userId, extraBound, instanceId, stepKey });
    }
    for (const item of pack.keep ?? []) {
      await releaseItem({ item, audience: "STAFF", protocolId, protocolVersionId: workflow.protocolVersionId, userId, extraBound, instanceId, stepKey });
    }
    return;
  }

  const forms = Array.isArray(payload.forms) ? payload.forms.filter((item): item is string => typeof item === "string") : ["F-39"];
  const certificate = typeof payload.certificate === "string" ? payload.certificate : "COA";
  const instances = await prisma.formInstance.findMany({
    where: {
      ownerType: "PROTOCOL_VERSION",
      ownerId: workflow.protocolVersionId,
      formDefinition: { code: { in: forms } },
    },
  });
  for (const instance of instances) {
    await renderFormDocument({ instanceId: instance.id, format: "docx", userId, extraBound });
    await renderFormDocument({ instanceId: instance.id, format: "pdf", userId, extraBound });
  }
  if (decision !== "APPROVED") return;
  if (!(await certificateReady(certificate))) {
    await warnMissing(instanceId, stepKey, CERTIFICATE_WARNING);
    return;
  }
  await renderCertificate({ code: certificate, protocolId, protocolVersionId: workflow.protocolVersionId, userId, extraBound, audience: null });
}

async function releaseItem(input: {
  item: ReleaseItem;
  audience: "PROPONENT" | "STAFF";
  protocolId: string;
  protocolVersionId: string;
  userId: string;
  extraBound: Record<string, unknown>;
  instanceId: string;
  stepKey: string;
}) {
  const key = releaseItemKey(input.item);
  const options = typeof input.item === "string" ? {} : { redact: input.item.redact, showOriginal: input.item.showOriginal };
  if (key.startsWith(CERTIFICATE_PREFIX)) {
    const code = key.slice(CERTIFICATE_PREFIX.length);
    if (!(await certificateReady(code))) {
      await warnMissing(input.instanceId, input.stepKey, `${code} was not attached. Its template is not in the system yet.`);
      return;
    }
    await renderCertificate({ code, protocolId: input.protocolId, protocolVersionId: input.protocolVersionId, userId: input.userId, extraBound: input.extraBound, audience: input.audience });
    return;
  }
  const instances = await prisma.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: input.protocolVersionId, formDefinition: { code: key }, filledByMemberId: null },
  });
  const changed = Boolean(options.redact?.length) || options.showOriginal === false;
  for (const instance of instances) {
    for (const format of ["docx", "pdf"] as const) {
      // The release copy proponents see, with its redactions and overrides.
      await renderFormDocument({
        instanceId: instance.id,
        format,
        userId: input.userId,
        extraBound: input.extraBound,
        variant: `release-${input.audience.toLowerCase()}`,
        audience: input.audience,
        options,
      });
      // Staff keep the full copy beside a changed one.
      if (changed && input.audience === "PROPONENT") {
        await renderFormDocument({
          instanceId: instance.id,
          format,
          userId: input.userId,
          extraBound: input.extraBound,
          variant: "release-staff",
          audience: "STAFF",
        });
      }
    }
  }
}

async function certificateBound(protocolVersionId: string): Promise<Record<string, unknown>> {
  const now = new Date();
  const [approvalPeriod, progressReportAfter, continuingReviewBefore] = await Promise.all([
    settingValue(prisma, "certificates.approvalPeriod", now),
    settingValue(prisma, "certificates.progressReportAfter", now),
    settingValue(prisma, "certificates.continuingReviewBefore", now),
  ]);
  const release = manilaDay(now);
  const dates = certificateDates(release, {
    approvalPeriod: parsePeriod(approvalPeriod),
    progressReportAfter: parsePeriod(progressReportAfter),
    continuingReviewBefore: parsePeriod(continuingReviewBefore),
  });
  void protocolVersionId;
  return {
    "certificate.releaseDate": dates.releaseDate,
    "certificate.validUntil": dates.validUntil ?? "",
    "certificate.progressReportDue": dates.progressReportDue ?? "",
    "certificate.continuingReviewDue": dates.continuingReviewDue ?? "",
  };
}

async function renderCertificate(input: {
  code: string;
  protocolId: string;
  protocolVersionId: string;
  userId: string;
  extraBound: Record<string, unknown>;
  audience: string | null;
}): Promise<void> {
  const definition = await prisma.formDefinition.findFirst({
    where: { code: input.code, templateFileId: { not: null } },
    orderBy: { publishedAt: "desc" },
  });
  const fileName = officialFormFileName(defaultFileNameSetting(), input.code, "pdf");
  const existing = await prisma.storedFile.findFirst({
    where: { protocolVersionId: input.protocolVersionId, kind: "GENERATED_PDF", originalName: fileName, variant: "certificate" },
  });
  if (existing) return;
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
    try {
      const raw = await readFile(join(process.cwd(), "templates", "maps", `${input.code}.json`), "utf8");
      map = placeholderMapSchema.parse(JSON.parse(raw));
    } catch {
      map = placeholderMapSchema.parse({});
    }
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
    ...(await certificateBound(input.protocolVersionId)),
    ...input.extraBound,
  };
  const model = buildRenderModel({
    map,
    data: {},
    bound: { ...PREVIEW_BOUND_VALUES, ...bound },
    signatures: [],
  });
  const docx = fillDocx(template, model.data, model.images);
  const pdf = Buffer.from(await convertDocxToPdf(docx));
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const storageKey = `generated/certificate/${input.protocolVersionId}/${input.code}/${sha256}`;
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
        variant: "certificate",
        audience: input.audience,
      },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileUploaded,
      entityType: "file",
      entityId: created.id,
      protocolId: input.protocolId,
      diff: diffOf({}, { kind: "GENERATED_PDF", originalName: fileName, audience: input.audience }),
      meta,
    });
  });
}
