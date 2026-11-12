"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveConflict } from "@/lib/forms/conflict";
import { INTAKE_SECTIONS } from "@/lib/intake/model";
import { isNextRedirect } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { saveInputError } from "@/server/forms/save-input";
import { saveIntakeSection, setAgreement, type IntakeSaveSuccess } from "@/server/intake/service";
import { requireUser } from "@/server/session";

const saveSchema = z.object({
  protocolId: z.string().uuid(),
  section: z.enum(INTAKE_SECTIONS as unknown as [string, ...string[]]),
  value: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
});

export type IntakeSaveResult = IntakeSaveSuccess | SaveConflict | { ok: false; code: string; message: string };

/** Autosave of one intake section, with the same conflict handling and audit trail as form fields. */
export async function saveIntakeAction(input: unknown): Promise<IntakeSaveResult> {
  try {
    const user = await requireUser();
    const parsed = saveSchema.parse(input);
    // protocol.edit admits proponents and advisers; the intake service then admits proponents only.
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    return await saveIntakeSection({
      protocolId: parsed.protocolId,
      userId: user.id,
      section: parsed.section as (typeof INTAKE_SECTIONS)[number],
      value: parsed.value,
      expectedRevision: parsed.expectedRevision,
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "Check the answers and try again.");
  }
}

const agreeSchema = z.object({
  protocolId: z.string().uuid(),
  kind: z.enum(["DECLARATIONS", "F28_CONSENT"]),
  agreed: z.boolean(),
});

export async function setAgreementAction(input: unknown): Promise<{ ok: true; agreed: boolean } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = agreeSchema.parse(input);
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    const result = await setAgreement({ ...parsed, userId: user.id });
    revalidatePath(`/app/protocols/${parsed.protocolId}`, "layout");
    return { ok: true, agreed: result.agreed };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "Your answer could not be saved.");
  }
}
