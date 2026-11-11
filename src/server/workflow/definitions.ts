import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { parseGraph, type WorkflowGraph } from "@/lib/workflow/graph";
import { validateGraph } from "@/lib/workflow/validate";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { publishedFormCodes } from "@/server/workflow/engine";

const emptyGraph: WorkflowGraph = {
  startStep: "start",
  steps: [
    {
      key: "start",
      name: "Start",
      type: "TASK",
      assignee: { kind: "PROTOCOL_LEADER" },
      statusLabel: "Draft",
    },
    { key: "end", name: "End", type: "END" },
  ],
  transitions: [{ from: "start", to: "end" }],
};

export async function listWorkflows() {
  return prisma.workflowDefinition.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { number: "desc" } } },
  });
}

export async function getWorkflowVersion(id: string) {
  const version = await prisma.workflowVersion.findUnique({
    where: { id },
    include: { definition: true, publishedBy: { select: { displayName: true } } },
  });
  if (!version) throw new AppError("NOT_FOUND", "That workflow version was not found.", 404);
  return version;
}

export async function createWorkflow(input: { key: string; name: string; submissionType: string; userId: string }) {
  const key = input.key.trim().toUpperCase().replaceAll(" ", "_");
  const meta = await auditRequestMeta({ key });
  try {
    return await prisma.$transaction(async (tx) => {
      const definition = await tx.workflowDefinition.create({
        data: { key, name: input.name.trim(), submissionType: input.submissionType.trim() },
      });
      const version = await tx.workflowVersion.create({
        data: { definitionId: definition.id, number: 1, status: "DRAFT", graph: toJson(emptyGraph) },
      });
      await audit.record(tx, {
        actorUserId: input.userId,
        action: AuditAction.workflowSaved,
        entityType: "workflow_version",
        entityId: version.id,
        diff: diffOf({}, { key, name: definition.name, number: 1 }),
        meta,
      });
      return version;
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "P2002") {
      throw new AppError("CONFLICT", "A workflow with that key already exists.", 409);
    }
    throw error;
  }
}

export async function saveDraftGraph(versionId: string, graph: unknown, userId: string) {
  const version = await getWorkflowVersion(versionId);
  if (version.status !== "DRAFT") throw new AppError("LOCKED", "Only a draft can be edited.", 409);
  const parsed = parseGraph(graph);
  if (!parsed.ok) throw new AppError("INVALID", parsed.message, 400);
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowVersion.update({
      where: { id: versionId },
      data: { graph: toJson(parsed.graph) },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.workflowSaved,
      entityType: "workflow_version",
      entityId: versionId,
      diff: { steps: parsed.graph.steps.length },
      meta,
    });
    return updated;
  });
}

export async function draftFromPublished(definitionId: string, userId: string) {
  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { versions: { orderBy: { number: "desc" } } },
  });
  if (!definition) throw new AppError("NOT_FOUND", "That workflow was not found.", 404);
  const source = definition.versions.find((version) => version.status === "PUBLISHED") ?? definition.versions[0];
  if (!source) throw new AppError("NOT_FOUND", "That workflow has no version to copy.", 404);
  if (definition.versions.some((version) => version.status === "DRAFT")) {
    throw new AppError("CONFLICT", "A draft of this workflow is already open.", 409);
  }
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const created = await tx.workflowVersion.create({
      data: {
        definitionId,
        number: source.number + 1,
        status: "DRAFT",
        graph: source.graph ?? {},
        notes: `Copied from version ${source.number}.`,
      },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.workflowSaved,
      entityType: "workflow_version",
      entityId: created.id,
      diff: { copiedFrom: source.number, number: created.number },
      meta,
    });
    return created;
  });
}

export async function validationIssues(versionId: string) {
  const version = await getWorkflowVersion(versionId);
  return validateGraph(version.graph, await publishedFormCodes());
}

/**
 * Publishes a draft. Without a date the earlier published versions are archived and new
 * protocols use this one at once. With a future `effectiveFrom` it is scheduled: the version in
 * effect now stays published, protocols created before the date keep it, and protocols created
 * on or after the date use this one.
 */
export async function publishWorkflow(versionId: string, userId: string, effectiveFrom: Date | null = null) {
  const version = await getWorkflowVersion(versionId);
  if (version.status !== "DRAFT") throw new AppError("LOCKED", "Only a draft can be published.", 409);
  const issues = await validationIssues(versionId);
  if (issues.length > 0) throw new AppError("INVALID", issues[0]?.message ?? "This workflow is not valid.", 400);
  const now = new Date();
  const scheduled = effectiveFrom && effectiveFrom.getTime() > now.getTime() ? effectiveFrom : null;
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    if (!scheduled) {
      await tx.workflowVersion.updateMany({
        where: { definitionId: version.definitionId, status: "PUBLISHED", OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
        data: { status: "ARCHIVED" },
      });
    }
    const published = await tx.workflowVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: now, publishedById: userId, effectiveFrom: scheduled, effectiveAnnouncedAt: null },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.workflowPublished,
      entityType: "workflow_version",
      entityId: versionId,
      diff: diffOf({ status: "DRAFT" }, { status: "PUBLISHED", number: published.number, effectiveFrom: scheduled?.toISOString() ?? null }),
      meta,
    });
    return published;
  });
}

/** Cancels a scheduled workflow version before its date. It returns to a draft. */
export async function cancelScheduledWorkflow(versionId: string, userId: string) {
  const version = await getWorkflowVersion(versionId);
  if (version.status !== "PUBLISHED" || !version.effectiveFrom || version.effectiveFrom.getTime() <= Date.now()) {
    throw new AppError("LOCKED", "Only a version scheduled for a later date can be cancelled.", 409);
  }
  const used = await prisma.workflowInstance.count({ where: { versionId } });
  if (used > 0) throw new AppError("LOCKED", "A protocol already runs on this version.", 409);
  const otherDraft = await prisma.workflowVersion.findFirst({ where: { definitionId: version.definitionId, status: "DRAFT" } });
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowVersion.update({
      where: { id: versionId },
      data: { status: otherDraft ? "ARCHIVED" : "DRAFT", publishedAt: null, effectiveFrom: null },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.workflowScheduleCancelled,
      entityType: "workflow_version",
      entityId: versionId,
      diff: diffOf({ status: "PUBLISHED", effectiveFrom: version.effectiveFrom?.toISOString() ?? null }, { status: updated.status }),
      meta,
    });
    return updated;
  });
}
