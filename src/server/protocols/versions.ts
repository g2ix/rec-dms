import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { versionLabel } from "@/lib/protocols/format";
import { appTimeZone } from "@/lib/time";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { freezeWorkingVersion, sharedSnapshot } from "@/server/protocols/snapshot";
import { completeLeaderSubmissionTx, completeOpenWaitTx, maybeStartInitial, maybeStartResubmissionTx } from "@/server/workflow/engine";
import { requiredFormCodes, requiredUploadKinds } from "@/server/protocols/settings";
import { formNeedsSignatures, signatureMarks, toRoster } from "@/server/signatures/sign";

export { sharedSnapshot };

type Tx = Prisma.TransactionClient;

export async function openWorkingVersion(tx: Tx, protocolId: string, at = new Date()) {
  const existing = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
  if (existing) return existing;
  const latest = await tx.protocolVersion.findFirst({
    where: { protocolId },
    orderBy: { number: "desc" },
  });
  const number = (latest?.number ?? 0) + 1;
  return tx.protocolVersion.create({
    data: {
      protocolId,
      number,
      label: versionLabel(number, at, appTimeZone()),
      state: "WORKING",
    },
  });
}

export async function ensureWorkingForms(tx: Tx, versionId: string) {
  const codes = await requiredFormCodes(tx);
  for (const code of codes) {
    const definition = await tx.formDefinition.findFirst({
      where: { code, status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!definition) continue;
    const existing = await tx.formInstance.findFirst({
      where: { formDefinitionId: definition.id, ownerType: "PROTOCOL_VERSION", ownerId: versionId },
    });
    if (existing) continue;
    await tx.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: versionId,
        data: {},
        status: "DRAFT",
      },
    });
  }
}

async function loadProtocol(tx: Tx, protocolId: string) {
  const protocol = await tx.protocol.findUnique({
    where: { id: protocolId },
    include: {
      members: { include: { user: true, contactEmail: true } },
    },
  });
  if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
  return protocol;
}

export async function submitVersion(protocolId: string, userId: string) {
  const account = await prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (account?.status !== "ACTIVE") {
    throw new AppError("PENDING_APPROVAL", "Your account is waiting for REC Staff approval.", 403);
  }
  const meta = await auditRequestMeta({});
  return prisma.$transaction(
    async (tx) => {
    await useAppSchema(tx);
    const member = await tx.protocolMember.findFirst({
      where: { protocolId, userId, status: "ACTIVE" },
    });
    if (!member?.isLeader || member.role !== "PROPONENT") {
      throw new AppError("FORBIDDEN", "Only the project leader can submit this protocol.", 403);
    }
    const version = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
    if (!version) throw new AppError("NOT_FOUND", "There is no working version to submit.", 404);

    const routed = await tx.workflowInstance.findFirst({
      where: { protocolId, protocolVersionId: version.id, status: "RUNNING" },
      select: { id: true },
    });
    const published = routed
      ? null
      : await tx.workflowVersion.findFirst({
          where: { status: "PUBLISHED", definition: { key: "INITIAL_SUBMISSION" } },
          select: { id: true },
        });
    if (routed || published) {
      return completeLeaderSubmissionTx(tx, protocolId, version.id, userId, meta);
    }

    const codes = await requiredFormCodes(tx);
    const missing: string[] = [];
    const needsSignatures: string[] = [];
    const instances = await tx.formInstance.findMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id },
      include: { formDefinition: true },
    });
    const protocol = await loadProtocol(tx, protocolId);
    const roster = toRoster(protocol.members);
    const marks = await signatureMarks(tx, instances.map((instance) => instance.id));
    for (const code of codes) {
      const instance = instances.find((item) => item.formDefinition.code === code);
      if (!instance) {
        missing.push(code);
        continue;
      }
      const parsed = validateSchema(instance.formDefinition.schema);
      if (!parsed.ok) {
        throw new AppError("INVALID", `${code} has a schema that cannot be checked.`, 400);
      }
      const issues = validateInstance({ schema: parsed.schema }, instance.data);
      if (issues.length > 0) {
        missing.push(code);
        continue;
      }
      if (formNeedsSignatures(parsed.schema, roster, marks.get(instance.id) ?? [])) needsSignatures.push(code);
    }
    if (missing.length > 0) {
      throw new AppError("INCOMPLETE", `Finish these forms before submitting: ${missing.join(", ")}.`, 400);
    }
    if (needsSignatures.length > 0) {
      throw new AppError(
        "INCOMPLETE",
        `Collect the required signatures on these forms: ${needsSignatures.join(", ")}.`,
        400,
      );
    }

    const kinds = await requiredUploadKinds(tx);
    const files = await tx.storedFile.findMany({ where: { protocolVersionId: version.id } });
    const absent = kinds.filter((kind) => !files.some((file) => file.kind === kind));
    if (absent.length > 0) {
      throw new AppError("INCOMPLETE", `Upload these files before submitting: ${absent.join(", ")}.`, 400);
    }

    const frozen = await freezeWorkingVersion(tx, { protocolId, userId, meta, status: "SUBMITTED" });
    return { versionId: frozen.versionId, label: frozen.label };
  },
    { timeout: 20_000, maxWait: 10_000 },
  );
}

export async function startRevision(protocolId: string, userId: string) {
  const meta = await auditRequestMeta({});
  let startInitial: string | null = null;
  const version = await prisma.$transaction(async (tx) => {
    const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
    if (!member?.isLeader || member.role !== "PROPONENT") {
      throw new AppError("FORBIDDEN", "Only the project leader can start a revision.", 403);
    }
    const working = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
    if (working) return working;
    const previous = await tx.protocolVersion.findFirst({
      where: { protocolId, state: "SUBMITTED" },
      orderBy: { number: "desc" },
    });
    const created = await openWorkingVersion(tx, protocolId);
    if (!previous) {
      await ensureWorkingForms(tx, created.id);
      startInitial = created.id;
      await audit.record(tx, {
        actorUserId: userId,
        actingRole: "PROJECT_LEADER",
        action: AuditAction.revisionStarted,
        entityType: "protocol_version",
        entityId: created.id,
        protocolId,
        diff: diffOf({ working: null }, { working: created.label }),
        meta,
      });
      return created;
    }
    const instances = await tx.formInstance.findMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: previous.id },
    });
    for (const instance of instances) {
      await tx.formInstance.create({
        data: {
          formDefinitionId: instance.formDefinitionId,
          ownerType: "PROTOCOL_VERSION",
          ownerId: created.id,
          data: instance.data ?? {},
          status: "DRAFT",
          filledByMemberId: instance.filledByMemberId,
        },
      });
    }
    await ensureWorkingForms(tx, created.id);
    await completeOpenWaitTx(tx, protocolId, userId, "RESUBMITTED", meta);
    const resubmission = await maybeStartResubmissionTx(tx, protocolId, created.id, userId, meta);
    if (!resubmission) await tx.protocol.update({ where: { id: protocolId }, data: { status: "DRAFT" } });
    await audit.record(tx, {
      actorUserId: userId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.revisionStarted,
      entityType: "protocol_version",
      entityId: created.id,
      protocolId,
      diff: diffOf({ working: null }, { working: created.label, copiedFrom: previous.label }),
      meta,
    });
    return created;
  }, { timeout: 20_000, maxWait: 10_000 });
  if (startInitial) await maybeStartInitial(protocolId, startInitial, userId);
  return version;
}
