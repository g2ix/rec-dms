"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";
import {
  createWorkflow,
  draftFromPublished,
  publishWorkflow,
  saveDraftGraph,
  validationIssues,
} from "@/server/workflow/definitions";
import { claimTask, completeTask, reassignTask, requestExtension } from "@/server/workflow/engine";
import { removeHoliday, saveHoliday } from "@/server/workflow/holidays";

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

export async function publishVersionAction(versionId: string): Promise<void> {
  const user = await requireUser();
  await authorize(user, "workflow.edit");
  const id = z.string().uuid().parse(versionId);
  try {
    await publishWorkflow(id, user.id);
  } catch (error) {
    redirect(`/admin/workflows/${id}?error=${encodeURIComponent(messageOf(error, "This draft cannot be published."))}`);
  }
  redirect(`/admin/workflows/${id}?published=1`);
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

export async function completeTaskAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const taskId = z.string().uuid().parse(formData.get("taskId"));
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  await authorize(user, "task.complete", { type: "task", id: taskId });
  const reviewers = formData.getAll("reviewerUserId").map(String).filter((id) => z.string().uuid().safeParse(id).success);
  try {
    await completeTask(taskId, user.id, {
      outcome: String(formData.get("outcome") ?? "").trim() || null,
      comment: String(formData.get("comment") ?? "").trim() || null,
      reviewerUserIds: reviewers,
      newDueAt: String(formData.get("newDueAt") ?? "").trim() || null,
      meetingDate: String(formData.get("meetingDate") ?? "").trim() || null,
    });
  } catch (error) {
    redirect(`/app/protocols/${protocolId}?error=${encodeURIComponent(messageOf(error, "The task could not be completed."))}`);
  }
  revalidatePath(`/app/protocols/${protocolId}`);
  revalidatePath("/app/tasks");
}

export async function requestExtensionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const instanceId = z.string().uuid().parse(formData.get("instanceId"));
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  await authorize(user, "protocol.submit", { type: "protocol", id: protocolId });
  try {
    await requestExtension(instanceId, user.id);
  } catch (error) {
    redirect(`/app/protocols/${protocolId}?error=${encodeURIComponent(messageOf(error, "The extension could not be requested."))}`);
  }
  revalidatePath(`/app/protocols/${protocolId}`);
  revalidatePath("/app/tasks");
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
