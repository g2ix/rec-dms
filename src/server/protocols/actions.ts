"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatDesignation } from "@/lib/affiliation";
import { affiliationSchema } from "@/lib/auth-schemas";
import { actionError, isNextRedirect, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { requireActiveUser, requireUser } from "@/server/session";
import { protocolDetailsSchema, changePanel, updateSharedDetails } from "@/server/protocols/details";
import { decideFee } from "@/server/protocols/fees";
import { acceptInvite, inviteMember, moveRoster, removeMember, transferLeadership } from "@/server/protocols/members";
import { presenceStore } from "@/server/protocols/presence";
import { confirmUpload, downloadFile, prepareUpload } from "@/server/protocols/uploads";
import { startRevision, submitVersion } from "@/server/protocols/versions";

function fail(error: unknown, fallback: string): ActionState {
  if (isNextRedirect(error)) throw error;
  return actionError(error, fallback);
}

function protocolId(formData: FormData): string {
  return z.string().uuid().parse(formData.get("protocolId"));
}

export async function inviteMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const id = protocolId(formData);
    await authorize(user, "protocol.members", { type: "protocol", id });
    const role = formData.get("role") === "ADVISER" ? "ADVISER" : "PROPONENT";
    const email = z.string().trim().email("Enter a valid email address.").parse(formData.get("email"));
    await inviteMember({ protocolId: id, actorUserId: user.id, email, role });
    revalidatePath(`/app/protocols/${id}/members`);
    return null;
  } catch (error) {
    return fail(error, "The invitation could not be sent.");
  }
}

export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const id = protocolId(formData);
    const kind = formData.get("kind") === "FACULTY" ? "FACULTY" : "STUDENT";
    const affiliation = affiliationSchema.parse({
      kind,
      course: formData.get("course"),
      yearLabel: formData.get("yearLabel"),
      position: formData.get("position"),
      unit: formData.get("unit"),
      institution: formData.get("institution"),
      contactEmailId: formData.get("contactEmailId"),
    });
    await acceptInvite({
      protocolId: id,
      userId: user.id,
      contactEmailId: affiliation.contactEmailId,
      contactNumber: String(formData.get("contactNumber") ?? "") || null,
      affiliationKind: affiliation.kind,
      course: affiliation.kind === "STUDENT" ? affiliation.course : null,
      yearLabel: affiliation.kind === "STUDENT" ? affiliation.yearLabel : null,
      position: affiliation.kind === "FACULTY" ? affiliation.position : null,
      unit: affiliation.kind === "FACULTY" ? affiliation.unit : null,
      institution: affiliation.institution,
      designation: formatDesignation(affiliation),
    });
    revalidatePath(`/app/protocols/${id}`);
    return null;
  } catch (error) {
    return fail(error, "The invitation could not be accepted.");
  }
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.members", { type: "protocol", id });
  await removeMember(id, user.id, z.string().uuid().parse(formData.get("memberId")));
  revalidatePath(`/app/protocols/${id}/members`);
}

export async function transferLeadershipAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.members", { type: "protocol", id });
  await transferLeadership(id, user.id, z.string().uuid().parse(formData.get("memberId")));
  revalidatePath(`/app/protocols/${id}`);
}

export async function moveRosterAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.members", { type: "protocol", id });
  const direction = formData.get("direction") === "down" ? "down" : "up";
  await moveRoster(id, user.id, z.string().uuid().parse(formData.get("memberId")), direction);
  revalidatePath(`/app/protocols/${id}/members`);
}

export async function updateDetailsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const id = protocolId(formData);
    await authorize(user, "protocol.edit", { type: "protocol", id });
    const details = protocolDetailsSchema.parse({
      title: formData.get("title"),
      institution: formData.get("institution"),
      institutionAddress: String(formData.get("institutionAddress") ?? ""),
      researchType: formData.get("researchType"),
      durationMonths: optionalCount(formData.get("durationMonths")),
      expectedParticipants: optionalCount(formData.get("expectedParticipants")),
      studySite: String(formData.get("studySite") ?? ""),
      fundingSources: formData
        .getAll("funding")
        .map((value) => String(value).trim())
        .filter(Boolean)
        .map((name) => ({ name })),
    });
    await updateSharedDetails(id, user.id, details);
    revalidatePath(`/app/protocols/${id}`);
    return null;
  } catch (error) {
    return fail(error, "The shared details could not be saved.");
  }
}

function optionalCount(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d+$/.test(text)) throw new AppError("INVALID", "Enter a whole number.", 400);
  return Number(text);
}

export async function changePanelAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.panel", { type: "protocol", id });
  await changePanel(id, user.id, z.string().uuid().parse(formData.get("panelId")));
  revalidatePath(`/app/protocols/${id}`);
}

export async function submitVersionAction(formData: FormData): Promise<void> {
  const user = await requireActiveUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.submit", { type: "protocol", id });
  try {
    await submitVersion(id, user.id);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    const message = error instanceof AppError ? error.message : "The version could not be submitted.";
    const { redirect } = await import("next/navigation");
    redirect(`/app/protocols/${id}?error=${encodeURIComponent(message)}`);
  }
  revalidatePath(`/app/protocols/${id}`);
}

export async function startRevisionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = protocolId(formData);
  await authorize(user, "protocol.members", { type: "protocol", id });
  await startRevision(id, user.id);
  revalidatePath(`/app/protocols/${id}`);
}

export async function prepareUploadAction(input: unknown): Promise<
  | { ok: true; intentId: string; url: string; headers: { "Content-Type": string }; suggestedName: string | null }
  | { ok: false; message: string }
> {
  try {
    const user = await requireUser();
    const parsed = z
      .object({
        protocolId: z.string().uuid(),
        kind: z.enum(["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT", "SUPPORTING"]),
        originalName: z.string().min(1).max(180),
        mime: z.string().min(1).max(120),
      })
      .parse(input);
    await authorize(user, "protocol.upload", { type: "protocol", id: parsed.protocolId });
    const prepared = await prepareUpload({ ...parsed, userId: user.id });
    return { ok: true, intentId: prepared.intentId, url: prepared.url, headers: prepared.headers, suggestedName: prepared.suggestedName };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Check the file and try again." };
    return { ok: false, message: "The upload could not be started." };
  }
}

export async function confirmUploadAction(input: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    const parsed = z.object({ intentId: z.string().uuid(), protocolId: z.string().uuid() }).parse(input);
    await authorize(user, "protocol.upload", { type: "protocol", id: parsed.protocolId });
    await confirmUpload({ intentId: parsed.intentId, userId: user.id });
    revalidatePath(`/app/protocols/${parsed.protocolId}/uploads`);
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    return { ok: false, message: "The upload could not be confirmed." };
  }
}

export async function downloadFileAction(
  input: unknown,
): Promise<{ ok: true; url: string; warning: string | null } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    const parsed = z.object({ fileId: z.string().uuid(), protocolId: z.string().uuid() }).parse(input);
    await authorize(user, "protocol.download", { type: "protocol", id: parsed.protocolId });
    const result = await downloadFile({ fileId: parsed.fileId, userId: user.id });
    return { ok: true, url: result.url, warning: result.warning };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    return { ok: false, message: "The file could not be opened." };
  }
}

export async function presenceAction(instanceId: string): Promise<{ ok: true; viewers: { id: string; name: string }[] } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    const viewers = await presenceStore.touch(user.id, instanceId);
    return { ok: true, viewers };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    return { ok: false, message: "Presence could not be updated." };
  }
}

export async function verifyFeeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const feeId = z.string().uuid().parse(formData.get("feeId"));
  const protocol = z.string().uuid().parse(formData.get("protocolId"));
  await authorize(user, "protocol.fee", { type: "protocol", id: protocol });
  await decideFee({ feeId, actorUserId: user.id, decision: "VERIFIED" });
  revalidatePath("/app/receipts");
}

export async function rejectFeeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const feeId = z.string().uuid().parse(formData.get("feeId"));
    const protocol = z.string().uuid().parse(formData.get("protocolId"));
    await authorize(user, "protocol.fee", { type: "protocol", id: protocol });
    await decideFee({
      feeId,
      actorUserId: user.id,
      decision: "REJECTED",
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/app/receipts");
    return null;
  } catch (error) {
    return fail(error, "The receipt could not be rejected.");
  }
}
