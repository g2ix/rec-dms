"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionFailure, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { cancelScheduledSetting, saveSetting } from "@/server/settings/admin";
import { requireUser } from "@/server/session";

export async function saveSettingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await authorize(user, "settings.data");
    const day = String(formData.get("effectiveFrom") ?? "").trim();
    await saveSetting({
      key: z.string().min(1, "Give the setting key.").parse(formData.get("key")),
      valueText: String(formData.get("value") ?? ""),
      effectiveFrom: /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00+08:00`) : null,
      actorUserId: user.id,
    });
    revalidatePath("/admin/settings");
    return null;
  } catch (error) {
    return actionFailure(error, "The setting could not be saved.");
  }
}

export async function cancelScheduledSettingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await authorize(user, "settings.data");
  await cancelScheduledSetting(z.string().uuid().parse(formData.get("id")), user.id);
  revalidatePath("/admin/settings");
}
