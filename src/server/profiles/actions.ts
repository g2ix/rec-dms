"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readNameParts } from "@/lib/name-parts";
import { profileDraftFromForm } from "@/lib/profile";
import { actionError, isNextRedirect, type ActionState } from "@/server/action-state";
import { savePersonProfile } from "@/server/profiles/profile";
import { requireUser } from "@/server/session";

const namePart = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80)
  .regex(/^[\p{L}][\p{L}\s.'-]*$/u, "Use letters, spaces, apostrophes, or hyphens.");

export async function saveProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const draft = profileDraftFromForm(formData);
    const firstName = namePart.parse(formData.get("firstName"));
    const familyName = namePart.parse(formData.get("familyName"));
    await savePersonProfile(user.id, draft, {
      firstName,
      familyName,
      ...readNameParts(formData),
    });
    revalidatePath("/app/account/profile");
    revalidatePath("/app/protocols/new");
    const protocolId = String(formData.get("protocolId") ?? "");
    if (z.string().uuid().safeParse(protocolId).success) {
      revalidatePath(`/app/protocols/${protocolId}/members`);
    }
    return null;
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return actionError(error, "The details could not be saved.");
  }
}
