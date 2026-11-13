"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveConflict } from "@/lib/forms/conflict";
import { INTAKE_SECTIONS } from "@/lib/intake/model";
import { isNextRedirect } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { saveInputError } from "@/server/forms/save-input";
import type { ActionResult } from "@/lib/action-result";
import { auditRequestMeta } from "@/server/audit";
import { saveIntakeSection, setAgreement, withdrawIntakeSigning, type IntakeSaveSuccess } from "@/server/intake/service";
import { signIntakeForms } from "@/server/intake/signing";
import { confirmSigningStepUp } from "@/server/stepup";
import { protocolResult } from "@/server/workflow/result";
import { studyPatchSchema, updateStudyFields } from "@/server/protocols/details";
import { generatedFormPreview, type GeneratedForm } from "@/server/intake/page";
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

const signSchema = z.object({
  protocolId: z.string().uuid(),
  password: z.string().optional(),
  code: z.string().optional(),
});

/**
 * "Sign F-27 and F-28": the same confirmation as signing a form (password, or the emailed code for
 * accounts without one), then one signing act for the current researcher on both forms.
 */
export async function signIntakeFormsAction(
  input: unknown,
): Promise<{ ok: true; result: ActionResult } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = signSchema.parse(input);
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    if (!user.passwordHash ? parsed.code : parsed.password) {
      await confirmSigningStepUp({ userId: user.id, password: parsed.password, code: parsed.code });
    }
    const meta = await auditRequestMeta({ forms: ["F-27", "F-28"] });
    const { signed } = await signIntakeForms({ protocolId: parsed.protocolId, userId: user.id, meta });
    revalidatePath(`/app/protocols/${parsed.protocolId}`, "layout");
    return {
      ok: true,
      result: await protocolResult({
        title: signed.length === 2 ? "F-27 and F-28 signed." : `${signed[0]?.code ?? "The form"} signed again.`,
        protocolId: parsed.protocolId,
        viewerId: user.id,
        target: "form",
      }),
    };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "The forms could not be signed.");
  }
}

const withdrawSchema = z.object({ protocolId: z.string().uuid() });

/** "Withdraw" on a signed row: withdraws both agreements, which voids both signatures. */
export async function withdrawIntakeSigningAction(input: unknown): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = withdrawSchema.parse(input);
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    await withdrawIntakeSigning({ protocolId: parsed.protocolId, userId: user.id });
    revalidatePath(`/app/protocols/${parsed.protocolId}`, "layout");
    return { ok: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "The signatures could not be withdrawn.");
  }
}

const studySchema = z.object({ protocolId: z.string().uuid(), patch: studyPatchSchema });

export type StudySaveResult = { ok: true } | { ok: false; code: string; message: string };

/**
 * Autosave of the intake's Study and Funding fields, which live on the protocol (the Details page).
 * Only the fields sent are written. There is no revision check: the Details form never had one.
 */
export async function saveStudyAction(input: unknown): Promise<StudySaveResult> {
  try {
    const user = await requireUser();
    const parsed = studySchema.parse(input);
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    await updateStudyFields(parsed.protocolId, user.id, parsed.patch);
    return { ok: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "Check this answer and try again.");
  }
}

const previewSchema = z.object({ protocolId: z.string().uuid(), instanceId: z.string().uuid() });

/** The read-only preview of one generated form, loaded when the proponent opens it. */
export async function formPreviewAction(input: unknown): Promise<{ ok: true; form: GeneratedForm } | { ok: false; code: string; message: string }> {
  try {
    const user = await requireUser();
    const parsed = previewSchema.parse(input);
    await authorize(user, "protocol.view", { type: "protocol", id: parsed.protocolId });
    return { ok: true, form: await generatedFormPreview(user.id, parsed.protocolId, parsed.instanceId) };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "The preview could not be opened.");
  }
}
