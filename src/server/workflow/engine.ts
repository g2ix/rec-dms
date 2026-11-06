import "server-only";
import type { Prisma, ProtocolMemberRole } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { getPath } from "@/lib/forms/paths";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { findField, validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { missingRequiredSignatures } from "@/lib/signatures/target";
import { manilaDayEnd } from "@/lib/time";
import { addDuration, manilaDay, subtractDuration } from "@/lib/workflow/calendar";
import { parseGraph, type AssigneeRule, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { pickTransition, stepIsComplete, type LogicData } from "@/lib/workflow/transitions";
import { audit } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { freezeWorkingVersion } from "@/server/protocols/snapshot";
import { signatureMarks, toRoster } from "@/server/signatures/sign";
import { isCommitteeStaff } from "@/server/authz/staff";
import { loadAuthoredRows } from "@/server/forms/authored";
import { prefillForm } from "@/server/workflow/prefill";
import { readAssignments, readRule, resolveSlots, roleKeysFor, userMatchesRule, type AssigneeSlot } from "@/server/workflow/who";

type Tx = Prisma.TransactionClient;
type Meta = Prisma.InputJsonObject;

const TX = { timeout: 20_000, maxWait: 10_000 } as const;
export const INITIAL_WORKFLOW_KEY = "INITIAL_SUBMISSION";
export type CompleteInput = {
  outcome?: string | null;
  comment?: string | null;
  reviewerUserIds?: string[];
  /** yyyy-MM-dd in Asia/Manila. Used when a side task approves a new due date. */
  newDueAt?: string | null;
  /** yyyy-MM-dd. Required when the step records a meeting date. */
  meetingDate?: string | null;
};

export type TaskResult = {
  alreadyCompleted: boolean;
  taskId: string;
  outcome: string | null;
  instanceId: string;
  instanceStatus: string;
  currentStepKeys: string[];
};

type InstanceRow = {
  id: string;
  versionId: string;
  protocolId: string;
  protocolVersionId: string;
  status: "RUNNING" | "COMPLETED" | "CANCELLED";
  currentStepKeys: string[];
  assignments: Prisma.JsonValue;
  parentInstanceId: string | null;
};

export async function startInstance(
  definitionKey: string,
  protocolId: string,
  protocolVersionId: string,
  actorUserId: string | null = null,
) {
  const meta = {};
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return startInstanceTx(tx, { definitionKey, protocolId, protocolVersionId, actorUserId, meta });
  }, TX);
}

export async function startInstanceTx(
  tx: Tx,
  input: {
    definitionKey: string;
    protocolId: string;
    protocolVersionId: string;
    actorUserId: string | null;
    meta: Meta;
    parentInstanceId?: string | null;
  },
) {
  const existing = await tx.workflowInstance.findFirst({
    where: {
      protocolId: input.protocolId,
      protocolVersionId: input.protocolVersionId,
      status: "RUNNING",
      version: { definition: { key: input.definitionKey } },
    },
  });
  if (existing) return existing;

  const published = await tx.workflowVersion.findFirst({
    where: { status: "PUBLISHED", definition: { key: input.definitionKey } },
  });
  if (!published) {
    throw new AppError("WORKFLOW_UNPUBLISHED", `No published workflow “${input.definitionKey}” is available.`, 409);
  }
  const graph = graphOf(published.graph);
  const instance = await tx.workflowInstance.create({
    data: {
      versionId: published.id,
      protocolId: input.protocolId,
      protocolVersionId: input.protocolVersionId,
      parentInstanceId: input.parentInstanceId ?? null,
      status: "RUNNING",
      currentStepKeys: [],
      assignments: {},
    },
  });
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: AuditAction.instanceStarted,
    entityType: "workflow_instance",
    entityId: instance.id,
    protocolId: input.protocolId,
    diff: { definitionKey: input.definitionKey, versionNumber: published.number },
    meta: input.meta,
  });
  await enterStep(tx, instance, graph, graph.startStep, input.actorUserId, input.meta, null, []);
  return tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
}

/** Opens the published initial workflow when the working version is created. No-op until one is published. */
export async function maybeStartInitial(protocolId: string, protocolVersionId: string, actorUserId: string) {
  const meta = {};
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return maybeStartInitialTx(tx, protocolId, protocolVersionId, actorUserId, meta);
  }, TX);
}

export async function maybeStartInitialTx(
  tx: Tx,
  protocolId: string,
  protocolVersionId: string,
  actorUserId: string,
  meta: Meta,
) {
  const published = await tx.workflowVersion.findFirst({
    where: { status: "PUBLISHED", definition: { key: INITIAL_WORKFLOW_KEY } },
    select: { id: true },
  });
  if (!published) return null;
  return startInstanceTx(tx, {
    definitionKey: INITIAL_WORKFLOW_KEY,
    protocolId,
    protocolVersionId,
    actorUserId,
    meta,
  });
}

export async function maybeStartResubmissionTx(
  tx: Tx,
  protocolId: string,
  protocolVersionId: string,
  actorUserId: string,
  meta: Meta,
) {
  const published = await tx.workflowVersion.findFirst({
    where: { status: "PUBLISHED", definition: { key: "RESUBMISSION" } },
    select: { id: true },
  });
  if (!published) return null;
  const parent = await tx.workflowInstance.findFirst({
    where: { protocolId },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return startInstanceTx(tx, {
    definitionKey: "RESUBMISSION",
    protocolId,
    protocolVersionId,
    actorUserId,
    meta,
    parentInstanceId: parent?.id ?? null,
  });
}

/** Submit button: complete the leader's open task. Requirements come from that step. */
export async function completeLeaderSubmissionTx(
  tx: Tx,
  protocolId: string,
  protocolVersionId: string,
  userId: string,
  meta: Meta,
): Promise<{ versionId: string; label: string }> {
  let instance = await tx.workflowInstance.findFirst({
    where: {
      protocolId,
      protocolVersionId,
      status: "RUNNING",
      version: { definition: { key: { in: [INITIAL_WORKFLOW_KEY, "RESUBMISSION"] } } },
    },
    orderBy: { startedAt: "desc" },
  });
  if (!instance) {
    instance = await startInstanceTx(tx, {
      definitionKey: INITIAL_WORKFLOW_KEY,
      protocolId,
      protocolVersionId,
      actorUserId: userId,
      meta,
    });
  }
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: protocolId } });
  const assignments = readAssignments(instance.assignments);
  const tasks = await tx.task.findMany({
    where: { instanceId: instance.id, status: { in: ["OPEN", "CLAIMED"] }, kind: "MAIN" },
    orderBy: { createdAt: "asc" },
  });
  let chosen: (typeof tasks)[number] | null = null;
  for (const task of tasks) {
    if (task.assigneeUserId === userId) {
      chosen = task;
      break;
    }
    if (!task.assigneeUserId) {
      const rule = readRule(task.candidateRule);
      if (rule && (await userMatchesRule(tx, rule, userId, protocol, assignments))) {
        chosen = task;
        break;
      }
    }
  }
  if (!chosen) throw new AppError("FORBIDDEN", "You do not have a task open on this protocol.", 403);
  await completeTaskTx(tx, chosen.id, userId, {}, meta);
  const version = await tx.protocolVersion.findFirst({
    where: { protocolId },
    orderBy: { number: "desc" },
  });
  const frozen = await tx.protocolVersion.findFirst({
    where: { id: protocolVersionId },
  });
  return { versionId: frozen?.id ?? version?.id ?? protocolVersionId, label: frozen?.label ?? version?.label ?? "" };
}

export async function completeTask(taskId: string, userId: string, input: CompleteInput = {}): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return completeTaskTx(tx, taskId, userId, input, {});
  }, TX);
}

export async function completeTaskTx(tx: Tx, taskId: string, userId: string, input: CompleteInput, meta: Meta): Promise<TaskResult> {
  await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task || !task.instanceId) throw new AppError("NOT_FOUND", "That task was not found.", 404);
  const instance = await tx.workflowInstance.findUnique({ where: { id: task.instanceId } });
  if (!instance) throw new AppError("NOT_FOUND", "That task was not found.", 404);
  if (task.status === "COMPLETED") return resultOf(task.id, task.outcome, instance, true);
  if (task.status !== "OPEN" && task.status !== "CLAIMED") {
    throw new AppError("INVALID", "That task is no longer open.", 409);
  }
  if (instance.status !== "RUNNING") throw new AppError("INVALID", "This workflow is no longer running.", 409);

  await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${instance.id} FOR UPDATE`;
  const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
  const graph = graphOf(version.graph);
  if (task.kind === "SIDE") return completeSideTask(tx, task, instance, graph, userId, input, meta);
  const step = stepOf(graph, task.stepKey ?? "");
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const assignments = readAssignments(instance.assignments);
  await assertCanAct(tx, task.assigneeUserId, readRule(task.candidateRule) ?? step.assignee ?? null, userId, protocol, assignments);

  const outcome = input.outcome?.trim() || null;
  if (step.type === "DECISION" || ((step.outcomes?.length ?? 0) > 0 && step.type !== "WAIT_PROPONENT")) {
    const keys = new Set((step.outcomes ?? []).map((item) => item.key));
    if (!outcome || !keys.has(outcome)) throw new AppError("INVALID", "Choose one of the outcomes for this step.", 400);
  }
  const comment = meetingComment(step, input);
  const preview = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome);
  const previewNext = pickTransition(graph, step.key, preview);
  const previewTarget = previewNext ? graph.steps.find((item) => item.key === previewNext.to) : undefined;
  const needsReviewers =
    previewTarget?.assignee?.kind === "ASSIGNED_IN_STEP" && previewTarget.assignee.stepKey === step.key;
  if (step.assignReviewers && (needsReviewers || (input.reviewerUserIds?.length ?? 0) > 0)) {
    const ids = input.reviewerUserIds ?? [];
    const max = step.assignReviewers.max;
    if (ids.length < step.assignReviewers.min || (max != null && ids.length > max)) {
      const span = max != null ? `${step.assignReviewers.min} to ${max}` : `at least ${step.assignReviewers.min}`;
      throw new AppError("INVALID", `Choose ${span} reviewers.`, 400);
    }
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID", "Choose each reviewer once.", 400);
    await assertReviewers(tx, protocol.id, ids, step.assignReviewers.roles);
    assignments[step.key] = ids;
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(assignments) } });
    for (const reviewerId of ids) await ensureReviewerMember(tx, protocol.id, reviewerId, step.assignReviewers.roles);
  }

  if (outcome && step.feeVerifiedOutcomes?.includes(outcome)) {
    const fee = await tx.feeVerification.findUnique({ where: { protocolVersionId: instance.protocolVersionId } });
    if (fee?.status !== "VERIFIED") {
      throw new AppError("INCOMPLETE", "Verify the fee receipt before accepting the submission.", 400);
    }
  }

  await assertStepReady(tx, instance.protocolVersionId, protocol.id, step, userId);
  const completedAt = new Date();
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      outcome,
      comment,
      assigneeUserId: task.assigneeUserId ?? userId,
      completedAt,
      completedById: userId,
    },
  });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.taskCompleted,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, outcome, status: "COMPLETED" },
    meta,
  });

  const siblings = await tx.task.findMany({ where: { instanceId: instance.id, stepKey: step.key, kind: "MAIN" } });
  if (!stepIsComplete(step, siblings)) return resultOf(task.id, outcome, instance, false);

  await tx.task.updateMany({
    where: { instanceId: instance.id, stepKey: step.key, status: { in: ["OPEN", "CLAIMED"] } },
    data: { status: "CANCELLED" },
  });
  await runActions(tx, step, "onExit", {
    protocolId: protocol.id,
    protocolVersionId: instance.protocolVersionId,
    userId,
    meta,
    instanceId: instance.id,
  });
  await applySetFields(tx, step, outcome, await formData(tx, instance.protocolVersionId), protocol.id);
  await queueCompleted(tx, step, protocol, assignments, userId);

  const logic = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome);
  const next = pickTransition(graph, step.key, logic);
  if (!next) throw new AppError("NO_TRANSITION", `“${step.name}” has no matching transition.`, 409);
  const fresh = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
  await enterStep(tx, fresh, graph, next.to, userId, meta, outcome, [], next.statusLabel);
  const after = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
  return resultOf(task.id, outcome, after, false);
}

export async function claimTask(taskId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    await claimTaskTx(tx, taskId, userId, {});
  }, TX);
}

export async function claimTaskTx(tx: Tx, taskId: string, userId: string, meta: Meta): Promise<void> {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task?.instanceId) throw new AppError("NOT_FOUND", "That task was not found.", 404);
  if (task.status === "CLAIMED" && task.assigneeUserId === userId) return;
  if (task.assigneeUserId) throw new AppError("INVALID", "That task is already claimed.", 409);
  if (task.status !== "OPEN") throw new AppError("INVALID", "That task is no longer open.", 409);
  const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: task.instanceId } });
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const rule = readRule(task.candidateRule);
  if (!rule || !(await userMatchesRule(tx, rule, userId, protocol, readAssignments(instance.assignments)))) {
    throw new AppError("FORBIDDEN", "This task is not assigned to you.", 403);
  }
  await tx.task.update({ where: { id: task.id }, data: { assigneeUserId: userId, status: "CLAIMED" } });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.taskClaimed,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { assigneeUserId: userId, status: "CLAIMED" },
    meta,
  });
}

export async function reassignTask(taskId: string, actorUserId: string, userId: string, reason: string): Promise<string> {
  if (!(await isCommitteeStaff(actorUserId))) {
    throw new AppError("FORBIDDEN", "Only REC Staff can reassign a task.", 403);
  }
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    return reassignTaskTx(tx, taskId, actorUserId, userId, reason, {});
  }, TX);
}

export async function reassignTaskTx(
  tx: Tx,
  taskId: string,
  actorUserId: string,
  userId: string,
  reason: string,
  meta: Meta,
): Promise<string> {
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task?.instanceId || !task.stepKey) throw new AppError("NOT_FOUND", "That task was not found.", 404);
  if (task.status !== "OPEN" && task.status !== "CLAIMED") {
    throw new AppError("INVALID", "That task is no longer open.", 409);
  }
  const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: task.instanceId } });
  const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
  const step = stepOf(graphOf(version.graph), task.stepKey);
  if (step.assignee?.kind === "ASSIGNED_IN_STEP") await assertReviewers(tx, instance.protocolId, [userId], []);
  await tx.task.update({ where: { id: task.id }, data: { status: "REASSIGNED" } });
  const created = await tx.task.create({
    data: {
      instanceId: instance.id,
      stepKey: task.stepKey,
      assigneeUserId: userId,
      candidateRule: task.candidateRule ?? undefined,
      title: task.title,
      status: "CLAIMED",
      dueAt: task.dueAt,
    },
  });
  await audit.record(tx, {
    actorUserId,
    action: AuditAction.taskReassigned,
    entityType: "task",
    entityId: created.id,
    protocolId: instance.protocolId,
    diff: { fromTaskId: task.id, fromUserId: task.assigneeUserId, toUserId: userId, reason },
    meta,
  });
  return created.id;
}

export async function cancelInstance(instanceId: string, actorUserId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const instance = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!instance) throw new AppError("NOT_FOUND", "That workflow was not found.", 404);
    if (instance.status !== "RUNNING") return;
    await tx.task.updateMany({
      where: { instanceId, status: { in: ["OPEN", "CLAIMED"] } },
      data: { status: "CANCELLED" },
    });
    await tx.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "CANCELLED", endedAt: new Date(), currentStepKeys: [] },
    });
    await tx.protocol.update({ where: { id: instance.protocolId }, data: { status: "Withdrawn" } });
    await audit.record(tx, {
      actorUserId,
      action: AuditAction.instanceCancelled,
      entityType: "workflow_instance",
      entityId: instanceId,
      protocolId: instance.protocolId,
      diff: { status: "CANCELLED" },
      meta: {},
    });
  }, TX);
}

async function completeSideTask(
  tx: Tx,
  task: {
    id: string;
    instanceId: string | null;
    stepKey: string | null;
    sideKey: string | null;
    assigneeUserId: string | null;
    candidateRule: Prisma.JsonValue;
  },
  instance: InstanceRow,
  graph: WorkflowGraph,
  userId: string,
  input: CompleteInput,
  meta: Meta,
): Promise<TaskResult> {
  const step = stepOf(graph, task.stepKey ?? "");
  const side = step.sideTasks?.find((item) => item.key === task.sideKey);
  if (!side) throw new AppError("INVALID", "That request is no longer part of this step.", 409);
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const assignments = readAssignments(instance.assignments);
  await assertCanAct(tx, task.assigneeUserId, readRule(task.candidateRule) ?? side.assignee, userId, protocol, assignments);
  const outcome = input.outcome?.trim() || null;
  if (!outcome || !side.outcomes.some((item) => item.key === outcome)) {
    throw new AppError("INVALID", "Choose one of the outcomes for this request.", 400);
  }
  if ((side.effect ?? "NONE") === "SET_DUE" && outcome === "APPROVE") {
    if (!input.newDueAt || !/^\d{4}-\d{2}-\d{2}$/.test(input.newDueAt)) {
      throw new AppError("INVALID", "Choose the new due date.", 400);
    }
    const dueAt = manilaDayEnd(input.newDueAt);
    const waiting = await tx.task.findFirst({
      where: { instanceId: instance.id, stepKey: step.key, kind: "MAIN", status: { in: ["OPEN", "CLAIMED"] } },
    });
    if (!waiting) throw new AppError("INVALID", "That step is no longer waiting.", 409);
    if (waiting.dueAt && dueAt.getTime() <= waiting.dueAt.getTime()) {
      throw new AppError("INVALID", "The new due date must be later than the current one.", 400);
    }
    await tx.task.update({ where: { id: waiting.id }, data: { dueAt } });
  }
  const completedAt = new Date();
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      outcome,
      comment: input.comment?.trim() || null,
      assigneeUserId: task.assigneeUserId ?? userId,
      completedAt,
      completedById: userId,
    },
  });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.taskCompleted,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, sideKey: side.key, outcome, status: "COMPLETED" },
    meta,
  });
  return resultOf(task.id, outcome, instance, false);
}

export async function requestExtension(instanceId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    await useAppSchema(tx);
    const instance = await tx.workflowInstance.findUnique({ where: { id: instanceId }, include: { version: true } });
    if (!instance || instance.status !== "RUNNING") throw new AppError("NOT_FOUND", "That workflow was not found.", 404);
    const graph = graphOf(instance.version.graph);
    const stepKey = instance.currentStepKeys[0];
    if (!stepKey) throw new AppError("INVALID", "This workflow has no open step.", 409);
    const step = stepOf(graph, stepKey);
    const side = step.sideTasks?.[0];
    if (!side) throw new AppError("INVALID", "This step does not accept an extension request.", 400);
    const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
    if (protocol.leaderUserId !== userId) {
      throw new AppError("FORBIDDEN", "Only the project leader can request an extension.", 403);
    }
    const existing = await tx.task.findFirst({
      where: { instanceId, stepKey, kind: "SIDE", sideKey: side.key, status: { in: ["OPEN", "CLAIMED"] } },
    });
    if (existing) return existing;
    const assignments = readAssignments(instance.assignments);
    const slots = await resolveSlots(tx, side.assignee, protocol, assignments);
    const slot = slots.find((item) => item.userId) ?? slots[0];
    if (!slot || (!slot.userId && slot.rule.kind !== "ROLE" && slot.rule.kind !== "PANEL_ROLE_OF_PROTOCOL")) {
      throw new AppError("NO_ASSIGNEE", "Nobody is assigned to decide the extension.", 409);
    }
    const created = await tx.task.create({
      data: {
        instanceId,
        stepKey,
        kind: "SIDE",
        sideKey: side.key,
        assigneeUserId: slot.userId,
        candidateRule: toJson(slot.rule),
        title: side.name,
        status: "OPEN",
      },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.extensionRequested,
      entityType: "task",
      entityId: created.id,
      protocolId: protocol.id,
      diff: { stepKey, sideKey: side.key },
      meta: {},
    });
    return created;
  }, TX);
}

/** Completes the leader's open proponent-wait, for example when a revision starts. */
export async function completeOpenWaitTx(
  tx: Tx,
  protocolId: string,
  userId: string,
  outcome: string,
  meta: Meta,
): Promise<void> {
  const tasks = await tx.task.findMany({
    where: {
      kind: "MAIN",
      status: { in: ["OPEN", "CLAIMED"] },
      assigneeUserId: userId,
      instance: { protocolId, status: "RUNNING" },
    },
    include: { instance: { include: { version: true } } },
  });
  for (const task of tasks) {
    if (!task.instance || !task.stepKey) continue;
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.type !== "WAIT_PROPONENT") continue;
    await completeTaskTx(tx, task.id, userId, { outcome }, meta);
  }
}

/** Completes overdue proponent waits with outcome OVERDUE. The graph decides where that leads. */
export async function lapseOverdueWaits(now = new Date()): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      kind: "MAIN",
      status: { in: ["OPEN", "CLAIMED"] },
      dueAt: { lt: now },
      assigneeUserId: { not: null },
      instance: { status: "RUNNING" },
    },
    include: { instance: { include: { version: true } } },
  });
  let count = 0;
  for (const task of tasks) {
    if (!task.instance || !task.stepKey || !task.assigneeUserId) continue;
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.type !== "WAIT_PROPONENT") continue;
    await completeTask(task.id, task.assigneeUserId, { outcome: "OVERDUE" });
    count += 1;
  }
  return count;
}

function meetingComment(step: Step, input: CompleteInput): string | null {
  const note = input.comment?.trim() || "";
  if (!step.capture?.meetingDate) return note || null;
  const date = input.meetingDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("INVALID", "Enter the meeting date.", 400);
  return note ? `Meeting date: ${date}\n${note}` : `Meeting date: ${date}`;
}

async function enterStep(
  tx: Tx,
  instance: InstanceRow,
  graph: WorkflowGraph,
  stepKey: string,
  actorUserId: string | null,
  meta: Meta,
  outcome: string | null,
  trail: string[],
  statusLabel?: string,
): Promise<void> {
  if (trail.includes(stepKey) || trail.length > 24) {
    throw new AppError("INVALID", "The workflow is looping without a person to continue it.", 409);
  }
  const step = stepOf(graph, stepKey);
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const label = statusLabel || step.statusLabel;
  if (label) {
    await tx.protocol.update({ where: { id: protocol.id }, data: { status: label } });
  }
  await audit.record(tx, {
    actorUserId,
    action: AuditAction.stepEntered,
    entityType: "workflow_instance",
    entityId: instance.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, stepName: step.name },
    meta,
  });
  const context = {
    protocolId: protocol.id,
    protocolVersionId: instance.protocolVersionId,
    userId: actorUserId,
    meta,
    instanceId: instance.id,
  };
  await runActions(tx, step, "onEnter", context, "other");
  if (step.type === "AUTO") {
    await applySetFields(tx, step, outcome, await formData(tx, instance.protocolVersionId), protocol.id);
    const logic = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome);
    const next = pickTransition(graph, step.key, logic);
    if (!next) throw new AppError("NO_TRANSITION", `“${step.name}” has no matching transition.`, 409);
    await enterStep(tx, instance, graph, next.to, actorUserId, meta, outcome, [...trail, step.key]);
    return;
  }
  if (step.type === "END") {
    await tx.workflowInstance.update({
      where: { id: instance.id },
      data: { status: "COMPLETED", endedAt: new Date(), currentStepKeys: [] },
    });
    await audit.record(tx, {
      actorUserId,
      action: AuditAction.instanceCompleted,
      entityType: "workflow_instance",
      entityId: instance.id,
      protocolId: protocol.id,
      diff: { status: "COMPLETED", stepKey: step.key },
      meta,
    });
    return;
  }

  const open = await tx.task.count({
    where: { instanceId: instance.id, stepKey: step.key, status: { in: ["OPEN", "CLAIMED"] } },
  });
  if (open > 0) {
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { currentStepKeys: [step.key] } });
    return;
  }

  const assignments = readAssignments((await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).assignments);
  if (step.assignee?.kind === "ASSIGNED_IN_STEP" && step.assignee.source === "parent" && instance.parentInstanceId) {
    const parent = await tx.workflowInstance.findUnique({ where: { id: instance.parentInstanceId } });
    assignments[step.assignee.stepKey] = readAssignments(parent?.assignments)[step.assignee.stepKey] ?? [];
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(assignments) } });
  }
  const rule = step.assignee ?? (step.type === "WAIT_PROPONENT" ? { kind: "PROTOCOL_LEADER" as const } : null);
  if (!rule) throw new AppError("INVALID", `“${step.name}” has no assignee.`, 409);
  const slots = await resolveSlots(tx, rule, protocol, assignments);
  if (slots.some((slot) => slot.userId == null) && rule.kind !== "ROLE" && rule.kind !== "PANEL_ROLE_OF_PROTOCOL") {
    if (slots.every((slot) => slot.userId == null)) {
      throw new AppError("NO_ASSIGNEE", `“${step.name}” has nobody to assign.`, 409);
    }
  }
  const holidays = await holidaySet(tx);
  const now = new Date();
  const dueAt = step.deadline ? addDuration(now, step.deadline.amount, step.deadline.unit, holidays) : null;
  const tasks = [];
  for (const slot of slots.filter((item) => item.userId != null || item.rule.kind === "ROLE" || item.rule.kind === "PANEL_ROLE_OF_PROTOCOL")) {
    const created = await tx.task.create({
      data: {
        instanceId: instance.id,
        stepKey: step.key,
        assigneeUserId: slot.userId,
        candidateRule: toJson(slot.rule),
        title: step.name,
        status: "OPEN",
        dueAt,
      },
    });
    tasks.push(created);
    await queueAssigned(tx, step, slot, protocol, assignments, created.id, dueAt, holidays);
  }
  if (tasks.length === 0) throw new AppError("NO_ASSIGNEE", `“${step.name}” has nobody to assign.`, 409);
  await openForms(tx, step, instance.protocolVersionId, slots);
  await runActions(tx, step, "onEnter", context, "prefill");
  await tx.workflowInstance.update({ where: { id: instance.id }, data: { currentStepKeys: [step.key] } });
}

async function assertCanAct(
  tx: Tx,
  assigneeUserId: string | null,
  rule: AssigneeRule | null,
  userId: string,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
) {
  if (assigneeUserId) {
    if (assigneeUserId !== userId) throw new AppError("FORBIDDEN", "This task is not assigned to you.", 403);
    return;
  }
  if (!rule || !(await userMatchesRule(tx, rule, userId, protocol, assignments))) {
    throw new AppError("FORBIDDEN", "This task is not assigned to you.", 403);
  }
}

async function assertReviewers(tx: Tx, protocolId: string, userIds: string[], allowedRoles: string[]) {
  const members = await tx.protocolMember.findMany({
    where: {
      protocolId,
      userId: { in: userIds },
      status: { not: "REMOVED" },
      role: { in: ["PROPONENT", "ADVISER"] },
    },
    select: { id: true },
  });
  if (members.length > 0) {
    throw new AppError("COI", "A proponent or adviser on this protocol cannot be assigned as a reviewer.", 409);
  }
  for (const userId of userIds) {
    if (allowedRoles.length === 0) continue;
    const keys = await roleKeysFor(tx, userId);
    if (!allowedRoles.some((role) => keys.has(role))) {
      throw new AppError("INVALID", "Each reviewer must hold one of the roles this step allows.", 400);
    }
  }
}

async function ensureReviewerMember(tx: Tx, protocolId: string, userId: string, allowed: string[]) {
  const existing = await tx.protocolMember.findFirst({ where: { protocolId, userId } });
  if (existing && (existing.role === "PROPONENT" || existing.role === "ADVISER")) return;
  const keys = [...(await roleKeysFor(tx, userId))];
  const role = reviewRole(keys, allowed);
  if (existing) {
    if (existing.status !== "ACTIVE" || existing.role !== role) {
      await tx.protocolMember.update({ where: { id: existing.id }, data: { status: "ACTIVE", role } });
    }
    return;
  }
  const count = await tx.protocolMember.count({ where: { protocolId } });
  await tx.protocolMember.create({
    data: { protocolId, userId, role, status: "ACTIVE", rosterOrder: count + 1 },
  });
}

function reviewRole(keys: string[], allowed: string[]): ProtocolMemberRole {
  const order: ProtocolMemberRole[] = ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "REVIEWER"];
  for (const role of order) {
    if (keys.includes(role) && (allowed.length === 0 || allowed.includes(role))) return role;
  }
  for (const role of order) {
    if (allowed.includes(role)) return role;
  }
  return "REVIEWER";
}

async function assertStepReady(tx: Tx, protocolVersionId: string, protocolId: string, step: Step, userId: string) {
  const member = await tx.protocolMember.findFirst({
    where: { protocolId, userId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  for (const form of step.forms ?? []) {
    if (!form.required || form.mode === "VIEW") continue;
    const definition = await tx.formDefinition.findFirst({
      where: { code: form.code, status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!definition) throw new AppError("INCOMPLETE", `Form ${form.code} is not published.`, 400);
    const instances = await tx.formInstance.findMany({
      where: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: protocolVersionId,
        ...(form.perAssignee && member ? { filledByMemberId: member.id } : {}),
      },
    });
    const instance = instances[0];
    if (!instance) throw new AppError("INCOMPLETE", `Finish ${form.code} before completing this step.`, 400);
    const parsed = validateSchema(definition.schema);
    if (!parsed.ok) throw new AppError("INVALID", `${form.code} has a schema that cannot be checked.`, 400);
    const actorRoles = await actorRoleKeys(tx, protocolId, userId);
    const allowedRows = await loadAuthoredRows(tx, userId, protocolVersionId, parsed.schema);
    if (form.mode === "FILL" || form.mode === "SIGN") {
      const issues = validateInstance({ schema: parsed.schema }, instance.data, { roles: actorRoles, stepKey: step.key, allowedRows });
      if (issues.length > 0) throw new AppError("INCOMPLETE", `Finish ${form.code} before completing this step.`, 400);
    }
    if (form.mode === "SIGN" || form.mode === "FILL") {
      const roster = toRoster(
        await tx.protocolMember.findMany({
          where: { protocolId, status: { in: ["ACTIVE", "INVITED"] } },
          include: { user: { select: { displayName: true } } },
        }),
      );
      const marks = await signatureMarks(tx, [instance.id]);
      const missing = missingRequiredSignatures(parsed.schema, roster, marks.get(instance.id) ?? [], {
        assigneeUserId: form.perAssignee ? member?.userId : null,
      }).filter((slot) => {
        const field = findField(parsed.schema, slot.fieldId);
        if (!field?.editableInSteps?.length) return true;
        return field.editableInSteps.includes(step.key);
      });
      if (missing.length > 0) {
        throw new AppError("INCOMPLETE", `Sign ${form.code} before completing this step.`, 400);
      }
    }
  }
  for (const upload of step.uploads ?? []) {
    if (!upload.required) continue;
    const file = await tx.storedFile.findFirst({ where: { protocolVersionId, kind: upload.kind } });
    if (!file) throw new AppError("INCOMPLETE", `Upload the ${upload.kind.toLowerCase().replaceAll("_", " ")} before completing this step.`, 400);
  }
}

async function openForms(tx: Tx, step: Step, protocolVersionId: string, slots: AssigneeSlot[]) {
  for (const form of step.forms ?? []) {
    const definition = await tx.formDefinition.findFirst({
      where: { code: form.code, status: "PUBLISHED" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!definition) continue;
    if (form.perAssignee) {
      for (const slot of slots) {
        if (!slot.userId) continue;
        const version = await tx.protocolVersion.findUnique({ where: { id: protocolVersionId }, select: { protocolId: true } });
        if (!version) continue;
        const member = await tx.protocolMember.findFirst({
          where: { protocolId: version.protocolId, userId: slot.userId, status: "ACTIVE" },
        });
        if (!member) continue;
        const existing = await tx.formInstance.findFirst({
          where: { formDefinitionId: definition.id, ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId, filledByMemberId: member.id },
        });
        if (existing) continue;
        const shared = await tx.formInstance.findFirst({
          where: { formDefinitionId: definition.id, ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId, filledByMemberId: null },
        });
        await tx.formInstance.create({
          data: {
            formDefinitionId: definition.id,
            ownerType: "PROTOCOL_VERSION",
            ownerId: protocolVersionId,
            filledByMemberId: member.id,
            data: shared?.data ?? {},
            status: "DRAFT",
          },
        });
      }
      continue;
    }
    const existing = await tx.formInstance.findFirst({
      where: { formDefinitionId: definition.id, ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId, filledByMemberId: null },
    });
    if (existing) continue;
    await tx.formInstance.create({
      data: {
        formDefinitionId: definition.id,
        ownerType: "PROTOCOL_VERSION",
        ownerId: protocolVersionId,
        data: {},
        status: "DRAFT",
      },
    });
  }
}

async function runActions(
  tx: Tx,
  step: Step,
  hook: "onEnter" | "onExit",
  ctx: { protocolId: string; protocolVersionId: string; userId: string | null; meta: Meta; instanceId: string },
  which: "all" | "prefill" | "other" = "all",
) {
  for (const action of step.actions ?? []) {
    const when = action.hook ?? "onEnter";
    if (when !== hook) continue;
    if (which === "prefill" && action.kind !== "PREFILL") continue;
    if (which === "other" && action.kind === "PREFILL") continue;
    if (action.kind === "SNAPSHOT_VERSION") {
      if (!ctx.userId) continue;
      await freezeWorkingVersion(tx, { protocolId: ctx.protocolId, userId: ctx.userId, meta: ctx.meta });
    } else if (action.kind === "ASSIGN_PROTOCOL_CODE") {
      await assignProtocolCode(tx, ctx.protocolId);
    } else if (action.kind === "GENERATE_DOCUMENTS" || action.kind === "NOTIFY") {
      await tx.job.create({
        data: {
          kind: action.kind,
          payload: toJson({ ...(action.params ?? {}), protocolId: ctx.protocolId, stepKey: step.key, instanceId: ctx.instanceId }),
          runAt: new Date(),
        },
      });
    } else if (action.kind === "PREFILL") {
      await prefillForm(tx, action.params ?? {}, { ...ctx, stepKey: step.key });
    } else if (action.kind === "START_WORKFLOW") {
      const definitionKey = typeof action.params?.definitionKey === "string" ? action.params.definitionKey : "";
      if (!definitionKey) throw new AppError("INVALID", `“${step.name}” starts a workflow without naming it.`, 400);
      await startInstanceTx(tx, {
        definitionKey,
        protocolId: ctx.protocolId,
        protocolVersionId: ctx.protocolVersionId,
        actorUserId: ctx.userId,
        meta: ctx.meta,
        parentInstanceId: ctx.instanceId,
      });
    }
  }
}

async function assignProtocolCode(tx: Tx, protocolId: string) {
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: protocolId }, select: { code: true } });
  if (protocol.code) return;
  const setting = await tx.setting.findUnique({ where: { key: "protocol.codePattern" } });
  const pattern = typeof setting?.value === "string" && setting.value.includes("{YYYY}") ? setting.value : "USC-REC-{YYYY}-{####}";
  const year = manilaDay(new Date()).slice(0, 4);
  const prefix = pattern.replace("{YYYY}", year).replace("{####}", "");
  const rows = await tx.protocol.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } });
  let max = 0;
  for (const row of rows) {
    const tail = Number(row.code?.slice(prefix.length));
    if (Number.isInteger(tail) && tail > max) max = tail;
  }
  const code = pattern.replace("{YYYY}", year).replace("{####}", String(max + 1).padStart(4, "0"));
  await tx.protocol.update({ where: { id: protocolId }, data: { code } });
}

async function applySetFields(tx: Tx, step: Step, outcome: string | null, forms: Record<string, unknown>, protocolId: string) {
  if (!step.setFields?.length) return;
  const data: { reviewType?: "EXEMPT" | "EXPEDITED" | "FULL" | null; status?: string; panelId?: string | null } = {};
  for (const field of step.setFields) {
    const raw = field.from === "outcome" ? outcome : readFormValue(forms, field.field);
    if (field.path === "protocol.reviewType") {
      data.reviewType = raw === "EXEMPT" || raw === "EXPEDITED" || raw === "FULL" ? raw : null;
    } else if (field.path === "protocol.status" && typeof raw === "string") {
      data.status = raw;
    } else if (field.path === "protocol.panelId") {
      data.panelId = typeof raw === "string" ? raw : null;
    }
  }
  if (Object.keys(data).length > 0) await tx.protocol.update({ where: { id: protocolId }, data });
}

function readFormValue(forms: Record<string, unknown>, field: string | undefined): unknown {
  if (!field) return null;
  const dot = field.indexOf(".");
  if (dot === -1) return null;
  return getPath(forms[field.slice(0, dot)], field.slice(dot + 1));
}

async function formData(tx: Tx, protocolVersionId: string): Promise<Record<string, unknown>> {
  const instances = await tx.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId },
    include: { formDefinition: { select: { code: true } } },
  });
  const forms: Record<string, unknown> = {};
  for (const instance of instances) forms[instance.formDefinition.code] = instance.data;
  return forms;
}

async function logicData(
  tx: Tx,
  protocolVersionId: string,
  protocol: { id: string; reviewType: string | null; panelId: string | null; status: string; code: string | null; title: string },
  stepKey: string,
  outcome: string | null,
): Promise<LogicData> {
  const fresh = await tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } });
  const completed = await tx.task.findMany({
    where: { instance: { protocolVersionId }, status: "COMPLETED", kind: "MAIN", outcome: { not: null } },
    orderBy: { completedAt: "asc" },
    select: { stepKey: true, outcome: true },
  });
  const decisions: Record<string, string | null> = {};
  for (const task of completed) {
    if (task.stepKey) decisions[task.stepKey] = task.outcome;
  }
  if (outcome) decisions[stepKey] = outcome;
  return {
    outcome,
    protocol: {
      id: fresh.id,
      reviewType: fresh.reviewType,
      panelId: fresh.panelId,
      status: fresh.status,
      code: fresh.code,
      title: fresh.title,
      hasAdviser: Boolean(
        await tx.protocolMember.findFirst({
          where: { protocolId: fresh.id, role: "ADVISER", status: "ACTIVE", userId: { not: null } },
          select: { id: true },
        }),
      ),
    },
    forms: await formData(tx, protocolVersionId),
    step: { key: stepKey },
    decisions,
  };
}

async function actorRoleKeys(tx: Tx, protocolId: string, userId: string): Promise<RoleKey[]> {
  const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
  const roles: RoleKey[] = [];
  if (member && isRoleKey(member.role)) roles.push(member.role);
  if (member?.isLeader && !roles.includes("PROJECT_LEADER")) roles.push("PROJECT_LEADER");
  for (const key of await roleKeysFor(tx, userId)) {
    if (isRoleKey(key) && !roles.includes(key)) roles.push(key);
  }
  return roles;
}

async function holidaySet(tx: Tx): Promise<Set<string>> {
  const rows = await tx.holiday.findMany({ select: { date: true } });
  return new Set(rows.map((row) => manilaDay(row.date)));
}

async function queueAssigned(
  tx: Tx,
  step: Step,
  slot: AssigneeSlot,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
  taskId: string,
  dueAt: Date | null,
  holidays: Set<string>,
) {
  const userIds = await notifyUserIds(tx, step, slot, protocol, assignments);
  if (step.notify?.onAssigned) {
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({ templateKey: step.notify.onAssigned, userIds, protocolId: protocol.id, taskId, stepKey: step.key }),
        runAt: new Date(),
      },
    });
  }
  if (!dueAt) return;
  for (const offset of step.deadline?.remindBefore ?? []) {
    if (!step.notify?.onDueSoon) continue;
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({ templateKey: step.notify.onDueSoon, userIds, protocolId: protocol.id, taskId, stepKey: step.key }),
        runAt: subtractDuration(dueAt, offset.amount, offset.unit, holidays),
      },
    });
  }
  if (step.notify?.onOverdue) {
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({
          templateKey: step.notify.onOverdue,
          userIds,
          protocolId: protocol.id,
          taskId,
          stepKey: step.key,
          escalateTo: step.deadline?.escalateTo ?? null,
        }),
        runAt: dueAt,
      },
    });
  }
}

async function queueCompleted(
  tx: Tx,
  step: Step,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
  userId: string,
) {
  if (!step.notify?.onCompleted) return;
  const extra: string[] = [];
  for (const rule of step.notify.cc ?? []) {
    const slots = await resolveSlots(tx, rule, protocol, assignments);
    for (const slot of slots) if (slot.userId) extra.push(slot.userId);
  }
  await tx.job.create({
    data: {
      kind: "NOTIFY",
      payload: toJson({
        templateKey: step.notify.onCompleted,
        userIds: [...new Set([userId, ...extra])],
        protocolId: protocol.id,
        stepKey: step.key,
      }),
      runAt: new Date(),
    },
  });
}

async function notifyUserIds(
  tx: Tx,
  step: Step,
  slot: AssigneeSlot,
  protocol: { id: string; panelId: string | null; leaderUserId: string },
  assignments: Record<string, string[]>,
): Promise<string[]> {
  if (slot.userId) return [slot.userId];
  if (slot.rule.kind === "ROLE" || slot.rule.kind === "PANEL_ROLE_OF_PROTOCOL") {
    const slots = await resolveSlots(tx, slot.rule, protocol, assignments);
    if (slots[0]?.userId) return [slots[0].userId];
    const grants = await tx.userRole.findMany({
      where: { revokedAt: null, role: { key: slot.rule.role } },
      select: { userId: true },
    });
    return [...new Set(grants.map((grant) => grant.userId))];
  }
  return [];
}

function graphOf(value: unknown): WorkflowGraph {
  const parsed = parseGraph(value);
  if (!parsed.ok) throw new AppError("INVALID", parsed.message, 400);
  return parsed.graph;
}

function stepOf(graph: WorkflowGraph, key: string): Step {
  const step = graph.steps.find((item) => item.key === key);
  if (!step) throw new AppError("INVALID", `The step “${key}” is not in this workflow version.`, 409);
  return step;
}

function resultOf(
  taskId: string,
  outcome: string | null,
  instance: { id: string; status: string; currentStepKeys: string[] },
  alreadyCompleted: boolean,
): TaskResult {
  return {
    alreadyCompleted,
    taskId,
    outcome,
    instanceId: instance.id,
    instanceStatus: instance.status,
    currentStepKeys: instance.currentStepKeys,
  };
}

export async function publishedFormCodes(tx: Tx = prisma): Promise<Set<string>> {
  const rows = await tx.formDefinition.findMany({ where: { status: "PUBLISHED" }, select: { code: true } });
  return new Set(rows.map((row) => row.code));
}
