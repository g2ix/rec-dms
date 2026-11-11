import "server-only";
import type { Prisma, ProtocolMemberRole } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { getPath } from "@/lib/forms/paths";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { findField, validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { missingRequiredSignatures } from "@/lib/signatures/target";
import { manilaDayEnd } from "@/lib/time";
import { addDuration, manilaDay } from "@/lib/workflow/calendar";
import { logicIsTrue } from "@/lib/forms/logic";
import { renderProtocolCode, sequenceFromCode, hasSequenceToken } from "@/lib/protocols/code";
import { parseGraph, slotsOf, stepAllowsConflict, type AssigneeRule, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { pickTransition, stepIsComplete, type LogicData } from "@/lib/workflow/transitions";
import { audit } from "@/server/audit";
import { prisma, useAppSchema as pinAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { freezeWorkingVersion } from "@/server/protocols/snapshot";
import { signatureMarks, toRoster } from "@/server/signatures/sign";
import { isCommitteeStaff } from "@/server/authz/staff";
import { loadAuthoredRows } from "@/server/forms/authored";
import { prefillForm } from "@/server/workflow/prefill";
import {
  claimable,
  eligibleForSlot,
  firstAvailable,
  readAssignments,
  readRule,
  readSlotAssignments,
  resolveSlots,
  roleKeysFor,
  slotOf,
  userMatchesRule,
  writeAssignments,
  type AssigneeSlot,
  type SlotAssignment,
} from "@/server/workflow/who";
import { formDefinitionForVersion, referenceDate, settingValue, workflowVersionFor } from "@/server/effective";
import { feeBlock, issueBillTx } from "@/server/fees/bills";
import { reopenVersionTx } from "@/server/protocols/reopen";

type Tx = Prisma.TransactionClient;
type Meta = Prisma.InputJsonObject;

const TX = { timeout: 20_000, maxWait: 10_000 } as const;
export const INITIAL_WORKFLOW_KEY = "INITIAL_SUBMISSION";
/** Side-task key the engine uses for re-designating one declined reviewer slot. */
export const REDESIGNATE_SIDE_KEY = "__redesignate";
export type CompleteInput = {
  outcome?: string | null;
  comment?: string | null;
  reviewerUserIds?: string[];
  /** Slot key to user id, for steps that assign reviewers by slot. */
  reviewerSlots?: Record<string, string>;
  noteToReviewers?: string | null;
  /** yyyy-MM-dd. */
  reviewDueDate?: string | null;
  /** REC Staff reason for choosing a fee-checked outcome while the bill is open. */
  feeOverrideReason?: string | null;
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
    await pinAppSchema(tx);
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

  const published = await workflowVersionFor(tx, input.definitionKey, await referenceDate(tx, input.protocolId));
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
    await pinAppSchema(tx);
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
  const published = await workflowVersionFor(tx, INITIAL_WORKFLOW_KEY, await referenceDate(tx, protocolId));
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
  const published = await workflowVersionFor(tx, "RESUBMISSION", await referenceDate(tx, protocolId));
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

export async function completeTask(taskId: string, userId: string | null, input: CompleteInput = {}): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
    return completeTaskTx(tx, taskId, userId, input, {});
  }, TX);
}

/**
 * Completes a task. `userId` null is the system, used when a deadline passes on a step with
 * `onTimeout`; it may only choose that outcome.
 */
export async function completeTaskTx(tx: Tx, taskId: string, userId: string | null, input: CompleteInput, meta: Meta): Promise<TaskResult> {
  await pinAppSchema(tx);
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
  if (task.kind === "SIDE") {
    if (!userId) throw new AppError("INVALID", "A request needs a person to answer it.", 409);
    return completeSideTask(tx, task, instance, graph, userId, input, meta);
  }
  const step = stepOf(graph, task.stepKey ?? "");
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const assignments = readAssignments(instance.assignments);
  const outcome = input.outcome?.trim() || null;
  if (userId) {
    await assertCanAct(tx, task.assigneeUserId, readRule(task.candidateRule) ?? step.assignee ?? null, userId, protocol, assignments);
  } else if (!step.onTimeout || outcome !== step.onTimeout.outcome) {
    throw new AppError("INVALID", "Only a timed-out step can be completed by the system.", 409);
  }

  if (step.type === "DECISION" || ((step.outcomes?.length ?? 0) > 0 && step.type !== "WAIT_PROPONENT")) {
    const keys = new Set((step.outcomes ?? []).map((item) => item.key));
    if (!outcome || !keys.has(outcome)) throw new AppError("INVALID", "Choose one of the outcomes for this step.", 400);
  }
  const chosen = step.outcomes?.find((item) => item.key === outcome);
  if (chosen?.requiresComment && !input.comment?.trim()) {
    throw new AppError("INVALID", `Give a reason for “${chosen.label}”.`, 400);
  }
  if (userId && step.decline && outcome === step.decline.outcome) {
    return declineTaskTx(tx, { task, instance, graph, step, protocol, userId, reason: input.comment?.trim() ?? "", meta });
  }
  const comment = meetingComment(step, input);
  const preview = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome, instance.parentInstanceId);
  const previewNext = pickTransition(graph, step.key, preview);
  const previewTarget = previewNext ? graph.steps.find((item) => item.key === previewNext.to) : undefined;
  const needsReviewers =
    previewTarget?.assignee?.kind === "ASSIGNED_IN_STEP" && previewTarget.assignee.stepKey === step.key;
  const slotted = slotsOf(step);
  if (step.assignReviewers && slotted.length > 0 && (needsReviewers || Object.keys(input.reviewerSlots ?? {}).length > 0)) {
    const chosenSlots = input.reviewerSlots ?? {};
    const rows: SlotAssignment[] = [];
    for (const slot of slotted) {
      const id = chosenSlots[slot.key]?.trim();
      if (!id) throw new AppError("INVALID", `Choose the ${slot.label}.`, 400);
      if (!(await eligibleForSlot(tx, id, slot.eligible))) {
        throw new AppError("INVALID", `That person cannot fill the ${slot.label} slot.`, 400);
      }
      rows.push({ userId: id, slot: slot.key });
    }
    const ids = rows.map((row) => row.userId);
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID", "Choose a different reviewer for each slot.", 400);
    await assertReviewers(tx, protocol.id, ids, []);
    const all = readSlotAssignments(instance.assignments);
    all[step.key] = rows;
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(writeAssignments(all)) } });
    assignments[step.key] = ids;
    for (const row of rows) {
      const roles = slotted.find((item) => item.key === row.slot)?.eligible?.roles ?? [];
      await ensureReviewerMember(tx, protocol.id, row.userId, roles);
    }
  } else if (step.assignReviewers && slotted.length === 0 && (needsReviewers || (input.reviewerUserIds?.length ?? 0) > 0)) {
    const ids = input.reviewerUserIds ?? [];
    const min = step.assignReviewers.min ?? 1;
    const roles = step.assignReviewers.roles ?? [];
    const max = step.assignReviewers.max;
    if (ids.length < min || (max != null && ids.length > max)) {
      const span = max != null ? `${min} to ${max}` : `at least ${min}`;
      throw new AppError("INVALID", `Choose ${span} reviewers.`, 400);
    }
    if (new Set(ids).size !== ids.length) throw new AppError("INVALID", "Choose each reviewer once.", 400);
    await assertReviewers(tx, protocol.id, ids, roles);
    assignments[step.key] = ids;
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(assignments) } });
    for (const reviewerId of ids) await ensureReviewerMember(tx, protocol.id, reviewerId, roles);
  }
  await saveCaptures(tx, instance.id, step, input);

  if (outcome && step.feeVerifiedOutcomes?.includes(outcome)) {
    const billsOnly = graph.steps.some((item) => item.actions?.some((action) => action.kind === "ISSUE_BILL"));
    const block = await feeBlock(tx, protocol.id, instance.protocolVersionId, { billsOnly });
    if (block) {
      const reason = input.feeOverrideReason?.trim() ?? "";
      const staff = userId ? (await roleKeysFor(tx, userId)).has("REC_STAFF") : false;
      if (!step.feeOverride || !staff || !block.billId) {
        throw new AppError("INCOMPLETE", step.feeOverride && block.billId ? `${block.message} Only REC Staff can release it, with a reason.` : block.message, 400);
      }
      if (!reason) throw new AppError("INVALID", "Type the reason for releasing with the bill open.", 400);
      await audit.record(tx, {
        actorUserId: userId,
        actingRole: "REC_STAFF",
        action: AuditAction.feeReleaseOverride,
        entityType: "bill",
        entityId: block.billId,
        protocolId: protocol.id,
        diff: { stepKey: step.key, outcome, outstanding: block.outstanding, reason },
        meta,
      });
    }
  }

  if (userId) await assertStepReady(tx, instance.protocolVersionId, protocol.id, step, userId, readSlotAssignments(instance.assignments));
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
    action: userId ? AuditAction.taskCompleted : AuditAction.taskTimedOut,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, outcome, status: "COMPLETED", ...(userId ? {} : { assigneeUserId: task.assigneeUserId }) },
    meta,
  });

  const siblings = await tx.task.findMany({ where: { instanceId: instance.id, stepKey: step.key, kind: "MAIN" } });
  if (!stepIsComplete(step, siblings)) return resultOf(task.id, outcome, instance, false);
  const redesignating = await tx.task.count({
    where: { instanceId: instance.id, stepKey: step.key, kind: "SIDE", sideKey: REDESIGNATE_SIDE_KEY, status: { in: ["OPEN", "CLAIMED"] } },
  });
  if (redesignating > 0) return resultOf(task.id, outcome, instance, false);

  await tx.task.updateMany({
    where: { instanceId: instance.id, stepKey: step.key, status: { in: ["OPEN", "CLAIMED"] } },
    data: { status: "CANCELLED" },
  });
  const exitContext = {
    protocolId: protocol.id,
    protocolVersionId: instance.protocolVersionId,
    userId,
    meta,
    instanceId: instance.id,
  };
  await runActions(tx, step, "onExit", exitContext, "other");
  await applySetFields(tx, step, outcome, await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome, instance.parentInstanceId), protocol.id);
  // A bill is priced from the review type this step may just have set.
  await runActions(tx, step, "onExit", exitContext, "bill");
  if (userId) await queueCompleted(tx, step, protocol, assignments, userId);

  const logic = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome, instance.parentInstanceId);
  const next = pickTransition(graph, step.key, logic);
  if (!next) throw new AppError("NO_TRANSITION", `“${step.name}” has no matching transition.`, 409);
  await queueTransitionNotice(tx, next.notify, protocol.id, protocol.leaderUserId);
  const fresh = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
  await enterStep(tx, fresh, graph, next.to, userId, meta, outcome, [], next.statusLabel);
  const after = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
  return resultOf(task.id, outcome, after, false);
}

export async function claimTask(taskId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
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
    await pinAppSchema(tx);
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
      slot: task.slot,
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
  await tx.job.create({
    data: {
      kind: "NOTIFY",
      payload: toJson({
        templateKey: "task.reassigned",
        userIds: [userId],
        protocolId: instance.protocolId,
        taskId: created.id,
        stepKey: task.stepKey,
      }),
      runAt: new Date(),
    },
  });
  return created.id;
}

export async function cancelInstance(instanceId: string, actorUserId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
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
  task: SideTaskRow,
  instance: InstanceRow,
  graph: WorkflowGraph,
  userId: string,
  input: CompleteInput,
  meta: Meta,
): Promise<TaskResult> {
  const step = stepOf(graph, task.stepKey ?? "");
  if (task.sideKey === REDESIGNATE_SIDE_KEY) return redesignateTx(tx, { task, instance, graph, step, userId, input, meta });
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
    await pinAppSchema(tx);
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
      dueAt: { lte: now },
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
    await applySetFields(tx, step, outcome, await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome, instance.parentInstanceId), protocol.id);
    await runActions(tx, step, "onEnter", context, "bill");
    const logic = await logicData(tx, instance.protocolVersionId, protocol, step.key, outcome, instance.parentInstanceId);
    const next = pickTransition(graph, step.key, logic);
    if (!next) throw new AppError("NO_TRANSITION", `“${step.name}” has no matching transition.`, 409);
    await queueTransitionNotice(tx, next.notify, protocol.id, protocol.leaderUserId);
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

  const stored = (await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).assignments;
  const assignments = readAssignments(stored);
  const slotted = readSlotAssignments(stored);
  if (step.assignee?.kind === "ASSIGNED_IN_STEP" && step.assignee.source === "parent" && instance.parentInstanceId) {
    const parent = await tx.workflowInstance.findUnique({ where: { id: instance.parentInstanceId } });
    const fromParent = readSlotAssignments(parent?.assignments)[step.assignee.stepKey] ?? [];
    slotted[step.assignee.stepKey] = fromParent;
    assignments[step.assignee.stepKey] = fromParent.map((row) => row.userId);
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(writeAssignments(slotted)) } });
  }
  const rule = step.assignee ?? (step.type === "WAIT_PROPONENT" ? { kind: "PROTOCOL_LEADER" as const } : null);
  if (!rule) throw new AppError("INVALID", `“${step.name}” has no assignee.`, 409);
  const slots = await resolveSlots(tx, rule, protocol, assignments, slotted);
  if (slots.some((slot) => slot.userId == null) && !claimable(rule)) {
    if (slots.every((slot) => slot.userId == null)) {
      throw new AppError("NO_ASSIGNEE", `“${step.name}” has nobody to assign.`, 409);
    }
  }
  const holidays = await holidaySet(tx);
  const now = new Date();
  const dueAt = step.deadline ? addDuration(now, step.deadline.amount, step.deadline.unit, holidays) : null;
  const tasks = [];
  for (const slot of slots.filter((item) => item.userId != null || claimable(item.rule))) {
    const created = await tx.task.create({
      data: {
        instanceId: instance.id,
        stepKey: step.key,
        assigneeUserId: slot.userId,
        candidateRule: toJson(slot.rule),
        title: step.name,
        status: "OPEN",
        dueAt,
        slot: slot.slot ?? null,
      },
    });
    tasks.push(created);
    await queueAssigned(tx, step, slot, protocol, assignments, created.id, instance.id);
  }
  if (tasks.length === 0) throw new AppError("NO_ASSIGNEE", `“${step.name}” has nobody to assign.`, 409);
  await openForms(tx, step, instance.protocolVersionId, slots);
  await runActions(tx, step, "onEnter", context, "prefill");
  await runActions(tx, step, "onEnter", context, "bill");
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
  const conflicted = await tx.conflictDeclaration.findFirst({ where: { protocolId, userId: { in: userIds } }, select: { id: true } });
  if (conflicted) throw new AppError("COI", "Someone you chose declared a conflict of interest on this protocol.", 409);
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

async function assertStepReady(
  tx: Tx,
  protocolVersionId: string,
  protocolId: string,
  step: Step,
  userId: string,
  slots: Record<string, SlotAssignment[]> = {},
) {
  const member = await tx.protocolMember.findFirst({
    where: { protocolId, userId, status: "ACTIVE" },
    select: { id: true, userId: true },
  });
  const mySlot = step.assignee?.kind === "ASSIGNED_IN_STEP" ? slotOf(slots, step.assignee.stepKey, userId) : null;
  for (const form of step.forms ?? []) {
    if (!form.required || form.mode === "VIEW") continue;
    if (form.slot && form.slot !== mySlot) continue;
    const definition = await formDefinitionForVersion(tx, form.code, protocolVersionId);
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
    const definition = await formDefinitionForVersion(tx, form.code, protocolVersionId);
    if (!definition) continue;
    if (form.perAssignee || form.slot) {
      for (const slot of slots) {
        if (!slot.userId) continue;
        if (form.slot && slot.slot !== form.slot) continue;
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
  which: "all" | "prefill" | "other" | "bill" = "all",
) {
  for (const action of step.actions ?? []) {
    const when = action.hook ?? "onEnter";
    if (when !== hook) continue;
    if (which === "prefill" && action.kind !== "PREFILL") continue;
    if (which === "other" && (action.kind === "PREFILL" || action.kind === "ISSUE_BILL")) continue;
    if (which === "bill" && action.kind !== "ISSUE_BILL") continue;
    if (action.kind === "SNAPSHOT_VERSION") {
      if (!ctx.userId) continue;
      await freezeWorkingVersion(tx, { protocolId: ctx.protocolId, userId: ctx.userId, meta: ctx.meta });
    } else if (action.kind === "ASSIGN_PROTOCOL_CODE") {
      await assignProtocolCode(tx, ctx.protocolId, ctx.userId, ctx.meta);
    } else if (action.kind === "REOPEN_VERSION") {
      const forms = Array.isArray(action.params?.forms) ? action.params.forms.filter((item): item is string => typeof item === "string") : [];
      await reopenVersionTx(tx, { protocolId: ctx.protocolId, protocolVersionId: ctx.protocolVersionId, forms, actorUserId: ctx.userId, meta: ctx.meta });
    } else if (action.kind === "ISSUE_BILL") {
      const basis = typeof action.params?.basis === "string" ? action.params.basis : "reviewType";
      await issueBillTx(tx, { protocolId: ctx.protocolId, protocolVersionId: ctx.protocolVersionId, basis, actorUserId: ctx.userId, meta: ctx.meta });
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

/** Legacy default used only while no `protocol.codePattern` setting exists. */
const FALLBACK_CODE_PATTERN = "USC-REC-{YYYY}-{####}";

/**
 * Issues the next code from the `protocol.codePattern` setting. The sequence is per year and kept
 * in `code_counters`; on first use in a year it starts after the highest code already issued
 * under the current pattern. Codes already issued never change.
 */
async function assignProtocolCode(tx: Tx, protocolId: string, actorUserId: string | null, meta: Meta) {
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: protocolId }, include: { leader: true } });
  if (protocol.code) return;
  const setting = await settingValue(tx, "protocol.codePattern");
  const pattern = typeof setting === "string" && hasSequenceToken(setting) ? setting : FALLBACK_CODE_PATTERN;
  const year = manilaDay(new Date()).slice(0, 4);
  const researcherCount = await tx.protocolMember.count({ where: { protocolId, role: "PROPONENT", status: "ACTIVE" } });
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(2142041, 13)`;
  const counter = await tx.codeCounter.findUnique({ where: { year: Number(year) } });
  let last = counter?.last ?? 0;
  // Codes issued under the current pattern by any other route (an import, an earlier pattern
  // with the same shape) still count, so the next number is above both.
  const rows = await tx.protocol.findMany({ where: { code: { contains: year } }, select: { code: true } });
  for (const row of rows) {
    const value = row.code ? sequenceFromCode(pattern, year, row.code) : null;
    if (value != null && value > last) last = value;
  }
  let code = "";
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    last += 1;
    code = renderProtocolCode(pattern, { year, sequence: last, leaderFamily: protocol.leader.familyName, researcherCount });
    const taken = await tx.protocol.findUnique({ where: { code }, select: { id: true } });
    if (!taken) break;
  }
  await tx.codeCounter.upsert({ where: { year: Number(year) }, create: { year: Number(year), last }, update: { last } });
  await tx.protocol.update({ where: { id: protocolId }, data: { code } });
  await audit.record(tx, {
    actorUserId,
    action: AuditAction.codeAssigned,
    entityType: "protocol",
    entityId: protocolId,
    protocolId,
    diff: { code, pattern },
    meta,
  });
}

async function applySetFields(tx: Tx, step: Step, outcome: string | null, logic: LogicData, protocolId: string) {
  if (!step.setFields?.length) return;
  const forms = logic.forms;
  const data: { reviewType?: "EXEMPT" | "EXPEDITED" | "FULL" | null; status?: string; panelId?: string | null } = {};
  for (const field of step.setFields) {
    if (field.when != null && !logicIsTrue(field.when, logic)) continue;
    const raw = field.from === "outcome" ? outcome : field.from === "value" ? (field.value ?? null) : readFormValue(forms, field.field);
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
  parentInstanceId: string | null = null,
): Promise<LogicData> {
  const fresh = await tx.protocol.findUniqueOrThrow({ where: { id: protocol.id } });
  const version = await tx.protocolVersion.findUnique({ where: { id: protocolVersionId }, select: { number: true } });
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
      round: version?.number ?? 1,
      clientTypeKey: fresh.clientTypeKey,
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
    parent: await parentFacts(tx, parentInstanceId),
  };
}

/** `parent.decision` is the last outcome chosen on a DECISION step of the earlier instance, such as a resubmission parent. */
async function parentFacts(tx: Tx, parentInstanceId: string | null): Promise<{ decision: string | null; decisions: Record<string, string | null> }> {
  if (!parentInstanceId) return { decision: null, decisions: {} };
  const parent = await tx.workflowInstance.findUnique({ where: { id: parentInstanceId }, include: { version: true } });
  if (!parent) return { decision: null, decisions: {} };
  const parsed = parseGraph(parent.version.graph);
  const decisionSteps = new Set(parsed.ok ? parsed.graph.steps.filter((item) => item.type === "DECISION").map((item) => item.key) : []);
  const tasks = await tx.task.findMany({
    where: { instanceId: parentInstanceId, status: "COMPLETED", kind: "MAIN", outcome: { not: null } },
    orderBy: { completedAt: "asc" },
    select: { stepKey: true, outcome: true },
  });
  const decisions: Record<string, string | null> = {};
  let decision: string | null = null;
  for (const task of tasks) {
    if (!task.stepKey) continue;
    decisions[task.stepKey] = task.outcome;
    if (decisionSteps.has(task.stepKey)) decision = task.outcome;
  }
  return { decision, decisions };
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
  instanceId: string,
) {
  if (!step.notify?.onAssigned) return;
  const userIds = await notifyUserIds(tx, step, slot, protocol, assignments);
  if (userIds.length === 0) return;
  const variables = await reviewerCaptureVariables(tx, instanceId, step);
  await tx.job.create({
    data: {
      kind: "NOTIFY",
      payload: toJson({ templateKey: step.notify.onAssigned, userIds, protocolId: protocol.id, taskId, stepKey: step.key, variables }),
      runAt: new Date(),
    },
  });
}

/** The note and due date the chair recorded on the step that chose these reviewers. */
export async function reviewerCaptures(
  tx: Tx | typeof prisma,
  instanceId: string,
  step: Step,
): Promise<{ noteToReviewers: string | null; reviewDueDate: string | null }> {
  if (step.assignee?.kind !== "ASSIGNED_IN_STEP") return { noteToReviewers: null, reviewDueDate: null };
  const instance = await tx.workflowInstance.findUnique({ where: { id: instanceId }, select: { captures: true, parentInstanceId: true } });
  const source = step.assignee.source === "parent" && instance?.parentInstanceId
    ? await tx.workflowInstance.findUnique({ where: { id: instance.parentInstanceId }, select: { captures: true } })
    : instance;
  const all = source?.captures && typeof source.captures === "object" && !Array.isArray(source.captures) ? (source.captures as Record<string, unknown>) : {};
  const entry = all[step.assignee.stepKey];
  const record = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as Record<string, unknown>) : {};
  return {
    noteToReviewers: typeof record.noteToReviewers === "string" && record.noteToReviewers.trim() ? record.noteToReviewers : null,
    reviewDueDate: typeof record.reviewDueDate === "string" && record.reviewDueDate ? record.reviewDueDate : null,
  };
}

async function reviewerCaptureVariables(tx: Tx, instanceId: string, step: Step): Promise<Record<string, string>> {
  const captured = await reviewerCaptures(tx, instanceId, step);
  return {
    noteToReviewers: captured.noteToReviewers ? `Note from the chair: ${captured.noteToReviewers}` : "",
    reviewDueDate: captured.reviewDueDate ? `Review due: ${captured.reviewDueDate}` : "",
  };
}

async function saveCaptures(tx: Tx, instanceId: string, step: Step, input: CompleteInput) {
  const wanted = step.capture;
  if (!wanted?.noteToReviewers && !wanted?.reviewDueDate) return;
  const entry: Record<string, string> = {};
  if (wanted.noteToReviewers && input.noteToReviewers?.trim()) entry.noteToReviewers = input.noteToReviewers.trim();
  if (wanted.reviewDueDate && input.reviewDueDate?.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDueDate.trim())) throw new AppError("INVALID", "Enter the review due date.", 400);
    entry.reviewDueDate = input.reviewDueDate.trim();
  }
  if (Object.keys(entry).length === 0) return;
  const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instanceId }, select: { captures: true } });
  const all = instance.captures && typeof instance.captures === "object" && !Array.isArray(instance.captures) ? { ...(instance.captures as Record<string, unknown>) } : {};
  all[step.key] = entry;
  await tx.workflowInstance.update({ where: { id: instanceId }, data: { captures: toJson(all) } });
}

async function queueTransitionNotice(tx: Tx, templateKey: string | undefined, protocolId: string, leaderUserId: string) {
  if (!templateKey) return;
  await tx.job.create({
    data: {
      kind: "NOTIFY",
      payload: toJson({ templateKey, userIds: [leaderUserId], protocolId }),
      runAt: new Date(),
    },
  });
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
  if (slot.rule.kind === "FIRST_AVAILABLE") {
    return (await firstAvailable(tx, slot.rule, protocol, assignments))?.userIds ?? [];
  }
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

type SideTaskRow = {
  id: string;
  instanceId: string | null;
  stepKey: string | null;
  sideKey: string | null;
  slot: string | null;
  assigneeUserId: string | null;
  candidateRule: Prisma.JsonValue;
  dueAt: Date | null;
};

type ProtocolRow = { id: string; panelId: string | null; leaderUserId: string };

/**
 * A reviewer declines a designation. Their task is closed as DECLINED, and a re-designation task
 * opens for the step's `decline.redesignateBy`. The other reviewers' tasks are not touched.
 */
async function declineTaskTx(
  tx: Tx,
  input: {
    task: SideTaskRow;
    instance: InstanceRow;
    graph: WorkflowGraph;
    step: Step;
    protocol: ProtocolRow;
    userId: string;
    reason: string;
    meta: Meta;
    conflict?: boolean;
  },
): Promise<TaskResult> {
  const { task, instance, step, protocol } = input;
  const decline = step.decline;
  if (!decline) throw new AppError("INVALID", "This step does not accept a decline.", 409);
  if (!input.reason.trim()) throw new AppError("INVALID", "Give the reason for declining.", 400);
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: "DECLINED",
      outcome: decline.outcome,
      comment: input.reason.trim(),
      assigneeUserId: task.assigneeUserId ?? input.userId,
      completedAt: new Date(),
      completedById: input.userId,
    },
  });
  await audit.record(tx, {
    actorUserId: input.userId,
    action: AuditAction.taskDeclined,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, slot: task.slot, outcome: decline.outcome, reason: input.reason.trim(), conflict: Boolean(input.conflict) },
    meta: input.meta,
  });
  const assignments = readAssignments(instance.assignments);
  const slots = await resolveSlots(tx, decline.redesignateBy, protocol, assignments);
  const slot = slots.find((item) => item.userId) ?? slots[0];
  if (!slot || (!slot.userId && !claimable(slot.rule))) {
    throw new AppError("NO_ASSIGNEE", "Nobody is set to re-designate the reviewer.", 409);
  }
  const created = await tx.task.create({
    data: {
      instanceId: instance.id,
      stepKey: step.key,
      kind: "SIDE",
      sideKey: REDESIGNATE_SIDE_KEY,
      slot: task.slot,
      assigneeUserId: slot.userId,
      candidateRule: toJson(slot.rule),
      title: decline.name ?? "Re-designate the reviewer",
      status: "OPEN",
    },
  });
  const notify = slot.userId ? [slot.userId] : await notifyUserIds(tx, step, slot, protocol, assignments);
  if (notify.length > 0) {
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({
          templateKey: "review.redesignate",
          userIds: notify,
          protocolId: protocol.id,
          taskId: created.id,
          stepKey: step.key,
          variables: { reason: input.reason.trim() },
        }),
        runAt: new Date(),
      },
    });
  }
  return resultOf(task.id, decline.outcome, instance, false);
}

/** The chair picks a new reviewer for the declined slot. Only that slot changes. */
async function redesignateTx(
  tx: Tx,
  input: { task: SideTaskRow; instance: InstanceRow; graph: WorkflowGraph; step: Step; userId: string; input: CompleteInput; meta: Meta },
): Promise<TaskResult> {
  const { task, instance, graph, step, userId } = input;
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const assignments = readAssignments(instance.assignments);
  await assertCanAct(tx, task.assigneeUserId, readRule(task.candidateRule) ?? step.decline?.redesignateBy ?? null, userId, protocol, assignments);
  if (step.assignee?.kind !== "ASSIGNED_IN_STEP") throw new AppError("INVALID", "This step has no reviewers to replace.", 409);
  const sourceKey = step.assignee.stepKey;
  const declined = await tx.task.findFirst({
    where: { instanceId: instance.id, stepKey: step.key, kind: "MAIN", status: "DECLINED", slot: task.slot },
    orderBy: { completedAt: "desc" },
  });
  const oldUserId = declined?.assigneeUserId ?? null;
  const replacement = (task.slot ? input.input.reviewerSlots?.[task.slot] : undefined) ?? input.input.reviewerUserIds?.[0] ?? "";
  if (!replacement) throw new AppError("INVALID", "Choose the new reviewer.", 400);
  const all = readSlotAssignments(instance.assignments);
  const rows = all[sourceKey] ?? [];
  if (rows.some((row) => row.userId === replacement)) throw new AppError("INVALID", "That person is already a reviewer on this protocol.", 400);
  if (replacement === oldUserId) throw new AppError("INVALID", "Choose someone other than the reviewer who declined.", 400);
  const source = graph.steps.find((item) => item.key === sourceKey);
  const slotDef = slotsOf(source).find((item) => item.key === task.slot);
  if (slotDef && !(await eligibleForSlot(tx, replacement, slotDef.eligible))) {
    throw new AppError("INVALID", `That person cannot fill the ${slotDef.label} slot.`, 400);
  }
  const roles = slotDef?.eligible?.roles ?? source?.assignReviewers?.roles ?? [];
  await assertReviewers(tx, protocol.id, [replacement], slotDef ? [] : roles);
  let replaced = false;
  const next = rows.map((row) => {
    if (!replaced && ((task.slot && row.slot === task.slot) || (!task.slot && row.userId === oldUserId))) {
      replaced = true;
      return { userId: replacement, slot: row.slot };
    }
    return row;
  });
  if (!replaced) next.push({ userId: replacement, slot: task.slot });
  all[sourceKey] = next;
  await tx.workflowInstance.update({ where: { id: instance.id }, data: { assignments: toJson(writeAssignments(all)) } });
  await ensureReviewerMember(tx, protocol.id, replacement, roles);
  await tx.task.update({
    where: { id: task.id },
    data: {
      status: "COMPLETED",
      outcome: "REDESIGNATED",
      comment: input.input.comment?.trim() || null,
      assigneeUserId: task.assigneeUserId ?? userId,
      completedAt: new Date(),
      completedById: userId,
    },
  });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.reviewerRedesignated,
    entityType: "task",
    entityId: task.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, slot: task.slot, fromUserId: oldUserId, toUserId: replacement },
    meta: input.meta,
  });
  const holidays = await holidaySet(tx);
  const dueAt = step.deadline ? addDuration(new Date(), step.deadline.amount, step.deadline.unit, holidays) : null;
  const created = await tx.task.create({
    data: {
      instanceId: instance.id,
      stepKey: step.key,
      assigneeUserId: replacement,
      candidateRule: toJson(step.assignee),
      title: step.name,
      status: "OPEN",
      dueAt,
      slot: task.slot,
    },
  });
  const freshAssignments = readAssignments(writeAssignments(all));
  const slotRow: AssigneeSlot = { userId: replacement, rule: step.assignee, slot: task.slot };
  await queueAssigned(tx, step, slotRow, protocol, freshAssignments, created.id, instance.id);
  await openForms(tx, step, instance.protocolVersionId, [slotRow]);
  return resultOf(task.id, "REDESIGNATED", instance, false);
}

/**
 * Declare a conflict of interest on an open task. On a FIRST_AVAILABLE step the task moves to the
 * next person in the chain; on a reviewer step with `decline` it works like a decline. REC Staff
 * are told either way.
 */
export async function declareConflict(taskId: string, userId: string, reason: string): Promise<TaskResult> {
  return prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
    return declareConflictTx(tx, taskId, userId, reason, {});
  }, TX);
}

export async function declareConflictTx(tx: Tx, taskId: string, userId: string, reason: string, meta: Meta): Promise<TaskResult> {
  const text = reason.trim();
  if (!text) throw new AppError("INVALID", "Give the reason for the conflict of interest.", 400);
  await tx.$queryRaw`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
  const task = await tx.task.findUnique({ where: { id: taskId } });
  if (!task?.instanceId || !task.stepKey || task.kind !== "MAIN") throw new AppError("NOT_FOUND", "That task was not found.", 404);
  if (task.status !== "OPEN" && task.status !== "CLAIMED") throw new AppError("INVALID", "That task is no longer open.", 409);
  const instance = await tx.workflowInstance.findUniqueOrThrow({ where: { id: task.instanceId } });
  const version = await tx.workflowVersion.findUniqueOrThrow({ where: { id: instance.versionId } });
  const graph = graphOf(version.graph);
  const step = stepOf(graph, task.stepKey);
  if (!stepAllowsConflict(step)) throw new AppError("INVALID", "A conflict of interest cannot be declared on this step.", 409);
  const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: instance.protocolId } });
  const assignments = readAssignments(instance.assignments);
  await assertCanAct(tx, task.assigneeUserId, readRule(task.candidateRule) ?? step.assignee ?? null, userId, protocol, assignments);
  const declaration = await tx.conflictDeclaration.create({
    data: { protocolId: protocol.id, userId, reason: text, stepKey: step.key },
  });
  await audit.record(tx, {
    actorUserId: userId,
    action: AuditAction.conflictDeclared,
    entityType: "conflict_declaration",
    entityId: declaration.id,
    protocolId: protocol.id,
    diff: { stepKey: step.key, taskId: task.id, reason: text },
    meta,
  });
  const staff = await tx.userRole.findMany({ where: { revokedAt: null, role: { key: "REC_STAFF" } }, select: { userId: true } });
  const staffIds = [...new Set(staff.map((row) => row.userId))];
  if (staffIds.length > 0) {
    await tx.job.create({
      data: {
        kind: "NOTIFY",
        payload: toJson({ templateKey: "conflict.declared", userIds: staffIds, protocolId: protocol.id, taskId: task.id, variables: { reason: text } }),
        runAt: new Date(),
      },
    });
  }
  if (step.assignee?.kind === "FIRST_AVAILABLE") {
    const slots = await resolveSlots(tx, step.assignee, protocol, assignments);
    const slot = slots[0];
    const available = await firstAvailable(tx, step.assignee, protocol, assignments);
    if (!slot || !available) throw new AppError("NO_ASSIGNEE", "Nobody else in the chain is available for this step.", 409);
    await tx.task.update({ where: { id: task.id }, data: { status: "REASSIGNED" } });
    const created = await tx.task.create({
      data: {
        instanceId: instance.id,
        stepKey: step.key,
        assigneeUserId: slot.userId,
        candidateRule: toJson(step.assignee),
        title: task.title,
        status: "OPEN",
        dueAt: task.dueAt,
        slot: task.slot,
      },
    });
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.taskReassigned,
      entityType: "task",
      entityId: created.id,
      protocolId: protocol.id,
      diff: { fromTaskId: task.id, fromUserId: task.assigneeUserId ?? userId, toUserId: slot.userId, reason: "Conflict of interest" },
      meta,
    });
    await queueAssigned(tx, step, slot, protocol, assignments, created.id, instance.id);
    return resultOf(task.id, null, instance, false);
  }
  if (step.decline) {
    return declineTaskTx(tx, { task, instance, graph, step, protocol, userId, reason: text, meta, conflict: true });
  }
  return resultOf(task.id, null, instance, false);
}

/**
 * SLA scan: completes open tasks whose deadline passed on a step with `onTimeout`, as the system.
 * Audited as task.timed_out.
 */
export async function timeoutOverdueTasks(now = new Date()): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: { kind: "MAIN", status: { in: ["OPEN", "CLAIMED"] }, dueAt: { lte: now }, instance: { status: "RUNNING" } },
    include: { instance: { include: { version: true } } },
    orderBy: { dueAt: "asc" },
  });
  let count = 0;
  for (const task of tasks) {
    if (!task.instance || !task.stepKey) continue;
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (!step?.onTimeout || step.type === "WAIT_PROPONENT") continue;
    await completeTask(task.id, null, { outcome: step.onTimeout.outcome });
    count += 1;
  }
  return count;
}

/**
 * Admin tool: move a running protocol to another published version of the same workflow and
 * resume at a chosen step. Completed history stays; open tasks are closed with a note. Only
 * while the protocol's workflowMigrationEnabled switch is on. Audited as workflow.migrated.
 */
export async function migrateInstance(input: {
  protocolId: string;
  targetVersionId: string;
  stepKey: string;
  actorUserId: string;
  note?: string | null;
}): Promise<TaskResult | null> {
  return prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
    const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: input.protocolId } });
    if (!protocol.workflowMigrationEnabled) throw new AppError("LOCKED", "Moving this protocol to another workflow version is switched off.", 409);
    const instance = await tx.workflowInstance.findFirst({
      where: { protocolId: input.protocolId, status: "RUNNING" },
      orderBy: { startedAt: "desc" },
      include: { version: true },
    });
    if (!instance) throw new AppError("NOT_FOUND", "This protocol has no running workflow.", 404);
    await tx.$queryRaw`SELECT id FROM workflow_instances WHERE id = ${instance.id} FOR UPDATE`;
    const target = await tx.workflowVersion.findUnique({ where: { id: input.targetVersionId } });
    if (!target || target.definitionId !== instance.version.definitionId || target.status !== "PUBLISHED") {
      throw new AppError("INVALID", "Choose a published version of the same workflow.", 400);
    }
    const graph = graphOf(target.graph);
    stepOf(graph, input.stepKey);
    const note = input.note?.trim() || `Moved to workflow version ${target.number}.`;
    const open = await tx.task.findMany({ where: { instanceId: instance.id, status: { in: ["OPEN", "CLAIMED"] } }, select: { id: true } });
    await tx.task.updateMany({
      where: { id: { in: open.map((task) => task.id) } },
      data: { status: "CANCELLED", comment: note },
    });
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { versionId: target.id, currentStepKeys: [] } });
    await audit.record(tx, {
      actorUserId: input.actorUserId,
      action: AuditAction.workflowMigrated,
      entityType: "workflow_instance",
      entityId: instance.id,
      protocolId: protocol.id,
      diff: { fromVersion: instance.version.number, toVersion: target.number, stepKey: input.stepKey, closedTasks: open.length, note },
      meta: {},
    });
    const fresh = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    await enterStep(tx, fresh, graph, input.stepKey, input.actorUserId, {}, null, []);
    const after = await tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
    return resultOf("", null, after, false);
  }, TX);
}

export async function setMigrationAllowed(protocolId: string, allowed: boolean, actorUserId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await pinAppSchema(tx);
    const protocol = await tx.protocol.findUniqueOrThrow({ where: { id: protocolId } });
    await tx.protocol.update({ where: { id: protocolId }, data: { workflowMigrationEnabled: allowed } });
    await audit.record(tx, {
      actorUserId,
      action: AuditAction.workflowMigrationToggled,
      entityType: "protocol",
      entityId: protocolId,
      protocolId,
      diff: { before: protocol.workflowMigrationEnabled, after: allowed },
      meta: {},
    });
  }, TX);
}

/** What the migration screen shows: the running version, the other published versions, and which step keys each keeps. */
export async function migrationPlan(protocolId: string) {
  const instance = await prisma.workflowInstance.findFirst({
    where: { protocolId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { version: { include: { definition: true } } },
  });
  if (!instance) return null;
  const current = parseGraph(instance.version.graph);
  const currentSteps = current.ok ? current.graph.steps : [];
  const versions = await prisma.workflowVersion.findMany({
    where: { definitionId: instance.version.definitionId, status: "PUBLISHED", id: { not: instance.versionId } },
    orderBy: { number: "desc" },
  });
  return {
    instanceId: instance.id,
    definitionName: instance.version.definition.name,
    versionNumber: instance.version.number,
    currentStepKeys: instance.currentStepKeys,
    targets: versions.map((version) => {
      const parsed = parseGraph(version.graph);
      const steps = parsed.ok ? parsed.graph.steps : [];
      return {
        id: version.id,
        number: version.number,
        steps: steps.map((step) => ({ key: step.key, name: step.name, type: step.type })),
        mapping: currentSteps.map((step) => ({ key: step.key, name: step.name, kept: steps.some((item) => item.key === step.key) })),
      };
    }),
  };
}
