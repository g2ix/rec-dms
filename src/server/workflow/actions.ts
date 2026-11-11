"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { REVIEWS_PATH, type ActionOutcome } from "@/lib/action-result";
import { actionFailure } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";
import {
  cancelScheduledWorkflow,
  createWorkflow,
  draftFromPublished,
  publishWorkflow,
  saveDraftGraph,
  validationIssues,
} from "@/server/workflow/definitions";
import { claimTask, completeTask, declareConflict, migrateInstance, reassignTask, requestExtension, setMigrationAllowed } from "@/server/workflow/engine";
import { removeHoliday, saveHoliday } from "@/server/workflow/holidays";
import { protocolResult, taskResult } from "@/server/workflow/result";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

export async function createWorkflowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const version = await createWorkflow({
    key: z.string().trim().min(1).parse(formData.get("key")),
    name: z.string().trim().min(1).parse(formData.get("name")),
    submissionType: z.string().trim().min(1).parse(formData.get("submissionType")),
    userId: user.id,
  });
  redirect(`/admin/workflows/${version.id}`);
}

export async function draftFromPublishedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const created = await draftFromPublished(z.string().uuid().parse(formData.get("definitionId")), user.id);
  redirect(`/admin/workflows/${created.id}`);
}

export async function saveDraftAction(versionId: string, graph: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  try {
    await saveDraftGraph(versionId, graph, user.id);
    revalidatePath(`/admin/workflows/${versionId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: messageOf(error, "The draft could not be saved.") };
  }
}

export async function validateDraftAction(versionId: string): Promise<{ messages: string[] }> {
  const user = await requireUser();
  await authorize(user, "workflow.view");
  const issues = await validationIssues(versionId);
  return { messages: issues.map((issue) => issue.message) };
}

export async function publishVersionAction(versionId: string, effectiveFrom: string | null = null): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const id = z.string().uuid().parse(versionId);
  const day = effectiveFrom && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) ? new Date(`${effectiveFrom}T00:00:00+08:00`) : null;
  try {
    await publishWorkflow(id, user.id, day);
  } catch (error) {
    redirect(`/admin/workflows/${id}?error=${encodeURIComponent(messageOf(error, "This draft cannot be published."))}`);
  }
  redirect(`/admin/workflows/${id}?published=1`);
}

export async function cancelScheduledWorkflowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const versionId = z.string().uuid().parse(formData.get("versionId"));
  try {
    await cancelScheduledWorkflow(versionId, user.id);
  } catch (error) {
    redirect(`/admin/workflows/${versionId}?error=${encodeURIComponent(messageOf(error, "The schedule could not be cancelled."))}`);
  }
  redirect(`/admin/workflows/${versionId}`);
}

export async function publishWorkflowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const versionId = z.string().uuid().parse(formData.get("versionId"));
  try {
    await publishWorkflow(versionId, user.id);
  } catch (error) {
    redirect(`/admin/workflows/${versionId}?error=${encodeURIComponent(messageOf(error, "This draft cannot be published."))}`);
  }
  redirect(`/admin/workflows/${versionId}?published=1`);
}

/** On success the caller shows the result dialog. On failure the message stays inline on the same page. */
export async function completeTaskAction(formData: FormData): Promise<ActionOutcome> {
  try {
    const user = await requireUser();
    const taskId = z.string().uuid().parse(formData.get("taskId"));
    const protocolId = z.string().uuid().parse(formData.get("protocolId"));
    await authorize(user, "task.complete", { type: "task", id: taskId });
    const reviewers = formData.getAll("reviewerUserId").map(String).filter((id) => z.string().uuid().safeParse(id).success);
    const reviewerSlots: Record<string, string> = {};
    for (const [name, value] of formData.entries()) {
      if (!name.startsWith("reviewerSlot:")) continue;
      const id = String(value);
      if (z.string().uuid().safeParse(id).success) reviewerSlots[name.slice("reviewerSlot:".length)] = id;
    }
    const text = (name: string) => String(formData.get(name) ?? "").trim() || null;
    await completeTask(taskId, user.id, {
      outcome: text("outcome"),
      comment: text("comment"),
      reviewerUserIds: reviewers,
      reviewerSlots,
      newDueAt: text("newDueAt"),
      meetingDate: text("meetingDate"),
      noteToReviewers: text("noteToReviewers"),
      reviewDueDate: text("reviewDueDate"),
      feeOverrideReason: text("feeOverrideReason"),
    });
    revalidatePath(`/app/protocols/${protocolId}`);
    revalidatePath(`/app/protocols/${protocolId}/forms`);
    revalidatePath("/app/tasks");
    revalidatePath(REVIEWS_PATH);
    return { ok: true, result: await taskResult(taskId, protocolId, user.id) };
  } catch (error) {
    return actionFailure(error, "The task could not be completed.");
  }
}

export async function declareConflictAction(formData: FormData): Promise<ActionOutcome> {
  try {
    const user = await requireUser();
    const taskId = z.string().uuid().parse(formData.get("taskId"));
    const protocolId = z.string().uuid().parse(formData.get("protocolId"));
    await authorize(user, "task.complete", { type: "task", id: taskId });
    await declareConflict(taskId, user.id, String(formData.get("reason") ?? ""));
    revalidatePath(`/app/protocols/${protocolId}`);
    revalidatePath("/app/tasks");
    revalidatePath(REVIEWS_PATH);
    return {
      ok: true,
      result: await protocolResult({ title: "Conflict of interest recorded.", protocolId, viewerId: user.id, target: "protocol", kind: "SIDE" }),
    };
  } catch (error) {
    return actionFailure(error, "The conflict of interest could not be recorded.");
  }
}

export async function requestExtensionAction(formData: FormData): Promise<ActionOutcome> {
  try {
    const user = await requireUser();
    const instanceId = z.string().uuid().parse(formData.get("instanceId"));
    const protocolId = z.string().uuid().parse(formData.get("protocolId"));
    await authorize(user, "protocol.submit", { type: "protocol", id: protocolId });
    await requestExtension(instanceId, user.id);
    revalidatePath(`/app/protocols/${protocolId}`);
    revalidatePath("/app/tasks");
    return {
      ok: true,
      result: await protocolResult({ title: "Extension requested.", protocolId, viewerId: user.id, target: "protocol", kind: "SIDE" }),
    };
  } catch (error) {
    return actionFailure(error, "The extension could not be requested.");
  }
}

export async function claimTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = z.string().uuid().parse(formData.get("taskId"));
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  await authorize(user, "task.claim", { type: "task", id: taskId });
  try {
    await claimTask(taskId, user.id);
  } catch (error) {
    redirect(`/app/protocols/${protocolId}?error=${encodeURIComponent(messageOf(error, "The task could not be claimed."))}`);
  }
  revalidatePath(`/app/protocols/${protocolId}`);
}

export async function reassignTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "task.reassign");
  const taskId = z.string().uuid().parse(formData.get("taskId"));
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  try {
    await reassignTask(
      taskId,
      user.id,
      z.string().uuid().parse(formData.get("userId")),
      z.string().trim().min(1).parse(formData.get("reason")),
    );
  } catch (error) {
    redirect(`/app/protocols/${protocolId}?error=${encodeURIComponent(messageOf(error, "The task could not be reassigned."))}`);
  }
  revalidatePath(`/app/protocols/${protocolId}`);
}

export async function saveHolidayAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "holiday.edit");
  try {
    await saveHoliday(String(formData.get("date") ?? ""), String(formData.get("name") ?? ""), user.id);
  } catch (error) {
    redirect(`/admin/holidays?error=${encodeURIComponent(messageOf(error, "The holiday could not be saved."))}`);
  }
  revalidatePath("/admin/holidays");
}

export async function removeHolidayAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "holiday.edit");
  await removeHoliday(z.string().uuid().parse(formData.get("id")), user.id);
  revalidatePath("/admin/holidays");
}

export async function setMigrationAllowedAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.migrate");
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  await setMigrationAllowed(protocolId, formData.get("allowed") === "on", user.id);
  revalidatePath(`/app/protocols/${protocolId}`);
}

export async function migrateInstanceAction(formData: FormData): Promise<ActionOutcome> {
  try {
    const user = await requireUser();
    await authorize(user, "workflow.migrate");
    const protocolId = z.string().uuid().parse(formData.get("protocolId"));
    await migrateInstance({
      protocolId,
      targetVersionId: z.string().uuid().parse(formData.get("targetVersionId")),
      stepKey: z.string().trim().min(1, "Choose the step to resume at.").parse(formData.get("stepKey")),
      actorUserId: user.id,
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath(`/app/protocols/${protocolId}`);
    return {
      ok: true,
      result: await protocolResult({ title: "Moved to the chosen workflow version.", protocolId, viewerId: user.id, target: "protocol" }),
    };
  } catch (error) {
    return actionFailure(error, "The protocol could not be moved.");
  }
}
