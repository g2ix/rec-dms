import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { versionLabel } from "@/lib/protocols/format";
import { appTimeZone, formatManila } from "@/lib/time";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { requiredFormCodes, requiredUploadKinds } from "@/server/protocols/settings";

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

type MemberRow = {
  role: string;
  status: string;
  rosterOrder: number;
  contactNumber: string | null;
  designation: string;
  user: { displayName: string } | null;
  contactEmail: { email: string } | null;
};

export function sharedSnapshot(
  protocol: {
    code: string | null;
    title: string;
    institution: string;
    institutionAddress: string;
    researchType: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    fundingSources: Prisma.JsonValue;
    disciplineId: string | null;
    panelId: string | null;
    members: MemberRow[];
  },
  label: string,
  submittedAt: Date | null,
) {
  const proponents = protocol.members
    .filter((member) => member.role === "PROPONENT" && member.status === "ACTIVE" && member.user)
    .sort((a, b) => a.rosterOrder - b.rosterOrder);
  return {
    "protocol.code": protocol.code,
    "protocol.title": protocol.title,
    "protocol.versionLabel": label,
    "protocol.researchers": proponents.map((member) => member.user?.displayName ?? ""),
    "protocol.contactNumbers": proponents.map((member) => member.contactNumber).filter((value): value is string => Boolean(value)),
    "protocol.emails": proponents.map((member) => member.contactEmail?.email).filter((value): value is string => Boolean(value)),
    "protocol.institution": protocol.institution,
    "protocol.institutionAddress": protocol.institutionAddress,
    "protocol.submissionDate": submittedAt ? formatManila(submittedAt, "yyyy-MM-dd") : null,
    researchType: protocol.researchType,
    durationMonths: protocol.durationMonths,
    expectedParticipants: protocol.expectedParticipants,
    studySite: protocol.studySite,
    fundingSources: protocol.fundingSources,
    disciplineId: protocol.disciplineId,
    panelId: protocol.panelId,
  };
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
  return prisma.$transaction(async (tx) => {
    const member = await tx.protocolMember.findFirst({
      where: { protocolId, userId, status: "ACTIVE" },
    });
    if (!member?.isLeader || member.role !== "PROPONENT") {
      throw new AppError("FORBIDDEN", "Only the project leader can submit this protocol.", 403);
    }
    const version = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
    if (!version) throw new AppError("NOT_FOUND", "There is no working version to submit.", 404);

    const codes = await requiredFormCodes(tx);
    const missing: string[] = [];
    const instances = await tx.formInstance.findMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id },
      include: { formDefinition: true },
    });
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
      if (issues.length > 0) missing.push(code);
    }
    if (missing.length > 0) {
      throw new AppError("INCOMPLETE", `Finish these forms before submitting: ${missing.join(", ")}.`, 400);
    }

    const kinds = await requiredUploadKinds(tx);
    const files = await tx.storedFile.findMany({ where: { protocolVersionId: version.id } });
    const absent = kinds.filter((kind) => !files.some((file) => file.kind === kind));
    if (absent.length > 0) {
      throw new AppError("INCOMPLETE", `Upload these files before submitting: ${absent.join(", ")}.`, 400);
    }

    const submittedAt = new Date();
    const protocol = await loadProtocol(tx, protocolId);
    const snapshot = sharedSnapshot(protocol, version.label, submittedAt);
    await tx.protocolVersion.update({
      where: { id: version.id },
      data: {
        state: "SUBMITTED",
        submittedAt,
        submittedById: userId,
        snapshot: toJson(snapshot),
      },
    });
    await tx.formInstance.updateMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id, status: { not: "LOCKED" } },
      data: { status: "LOCKED" },
    });
    await tx.protocol.update({ where: { id: protocolId }, data: { status: "SUBMITTED" } });
    await audit.record(tx, {
      actorUserId: userId,
      actingRole: "PROJECT_LEADER",
      action: AuditAction.versionSubmitted,
      entityType: "protocol_version",
      entityId: version.id,
      protocolId,
      diff: diffOf({ state: "WORKING", status: protocol.status }, { state: "SUBMITTED", status: "SUBMITTED", label: version.label }),
      meta,
    });
    return { versionId: version.id, label: version.label };
  });
}

export async function startRevision(protocolId: string, userId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
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
        },
      });
    }
    await ensureWorkingForms(tx, created.id);
    await tx.protocol.update({ where: { id: protocolId }, data: { status: "DRAFT" } });
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
  });
}
