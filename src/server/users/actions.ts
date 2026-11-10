"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actionError, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { changePanelChair, grantRole, revokeRole } from "@/server/users/roles";

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
    revalidatePath("/admin/panels");
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
    revalidatePath("/admin/panels");
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
    revalidatePath("/admin/panels");
    redirect("/admin/panels?changed=1");
  } catch (error) {
    return actionError(error, "The Panel Chair could not be changed.");
  }
}
