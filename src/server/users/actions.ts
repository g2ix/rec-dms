"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { decidePendingUser } from "@/server/auth/users";
import {
  applyRoleChanges,
  approvePendingUser,
  askToCompleteProfile,
  changePanelChair,
  grantRole,
  revokeRole,
} from "@/server/users/roles";

const grantSchema = z.object({
  userId: z.string().uuid("That account was not found."),
  roleId: z.string().uuid("Choose a role."),
  panelId: z.union([z.literal(""), z.string().uuid("Choose a panel.")]),
});

const revokeSchema = z.object({
  userId: z.string().uuid("That account was not found."),
  userRoleId: z.string().uuid("That role was not found."),
  reason: z.string().trim().min(1, "Enter the reason for revoking this role.").max(500, "Keep the reason under 500 characters."),
});

const chairSchema = z.object({
  panelId: z.string().uuid("That panel was not found."),
  newChairUserId: z.string().uuid("Choose the new Panel Chair."),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters."),
});

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

export async function grantRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const input = grantSchema.parse({
      userId: text(formData, "userId"),
      roleId: text(formData, "roleId"),
      panelId: text(formData, "panelId"),
    });
    await grantRole({ actorUserId: actor.id, userId: input.userId, roleId: input.roleId, panelId: input.panelId || null });
    revalidatePath("/admin/users/panels");
    redirect(`/admin/users/${input.userId}?done=granted`);
  } catch (error) {
    return actionError(error, "The role could not be granted.");
  }
}

export async function revokeRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const input = revokeSchema.parse({
      userId: text(formData, "userId"),
      userRoleId: text(formData, "userRoleId"),
      reason: text(formData, "reason"),
    });
    await revokeRole({ actorUserId: actor.id, userRoleId: input.userRoleId, reason: input.reason });
    revalidatePath("/admin/users/panels");
    redirect(`/admin/users/${input.userId}?done=revoked`);
  } catch (error) {
    return actionError(error, "The role could not be revoked.");
  }
}

export async function changePanelChairAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const input = chairSchema.parse({
      panelId: text(formData, "panelId"),
      newChairUserId: text(formData, "newChairUserId"),
      reason: text(formData, "reason"),
    });
    await changePanelChair({ actorUserId: actor.id, ...input });
    revalidatePath("/admin/users/panels");
    redirect("/admin/users/panels?changed=1");
  } catch (error) {
    return actionError(error, "The Panel Chair could not be changed.");
  }
}

const changesSchema = z.object({
  userId: z.string().uuid("That account was not found."),
  add: z.array(z.object({ roleId: z.string().uuid("Choose a role."), panelId: z.string().uuid().nullable() })).max(60),
  remove: z.array(z.string().uuid("That role was not found.")).max(60),
  reason: z.string().trim().max(500, "Keep the reason under 500 characters."),
});

/** The role board posts its staged changes as one JSON field, so they save together or not at all. */
export async function applyRoleChangesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const input = changesSchema.parse({
      userId: text(formData, "userId"),
      ...JSON.parse(text(formData, "changes") || "{}"),
      reason: text(formData, "reason"),
    });
    const result = await applyRoleChanges({ actorUserId: actor.id, ...input });
    revalidatePath("/admin/users/panels");
    redirect(`/admin/users/${input.userId}?done=${result.granted}-${result.revoked}`);
  } catch (error) {
    return actionError(error, "The roles could not be saved.");
  }
}

const approveSchema = z.object({
  userId: z.string().uuid("That account was not found."),
  accountRoles: z.array(z.enum(["PROPONENT", "ADVISER"])).min(1, "Choose what this account is for: proponent, adviser, or both."),
});

export async function approvePendingUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const input = approveSchema.parse({ userId: text(formData, "userId"), accountRoles: formData.getAll("accountRole").map(String) });
    await approvePendingUser({ actorUserId: actor.id, ...input });
    redirect("/admin/users/pending?done=approved");
  } catch (error) {
    return actionError(error, "The account could not be approved.");
  }
}

export async function rejectPendingUserAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const userId = z.string().uuid("That account was not found.").parse(text(formData, "userId"));
    await decidePendingUser({ actorUserId: actor.id, userId, decision: "reject" });
    redirect("/admin/users/pending?done=rejected");
  } catch (error) {
    return actionError(error, "The account could not be rejected.");
  }
}

export async function askToCompleteProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await requireUser();
    await authorize(actor, "users.manage");
    const userId = z.string().uuid("That account was not found.").parse(text(formData, "userId"));
    await askToCompleteProfile({ actorUserId: actor.id, userId });
    redirect(`/admin/users/pending?done=asked&id=${userId}`);
  } catch (error) {
    return actionError(error, "The reminder could not be sent.");
  }
}
