"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { actionError, type ActionState } from "@/server/action-state";
import { protocolResult } from "@/server/workflow/result";
import { issueEmailCode } from "@/server/auth/codes";
import { authorize } from "@/server/authz";
import { auditRequestMeta } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";
import { signField } from "@/server/signatures/sign";
import { saveSignatureImage } from "@/server/signatures/store";
import { confirmSigningStepUp, contactEmail } from "@/server/stepup";

const signSchema = z.object({
  instanceId: z.string().uuid(),
  fieldPath: z.string().min(1).max(240),
  password: z.string().optional(),
  code: z.string().optional(),
});

async function protocolForInstance(instanceId: string): Promise<string> {
  const instance = await prisma.formInstance.findUnique({ where: { id: instanceId } });
  if (!instance || instance.ownerType !== "PROTOCOL_VERSION") {
    throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
  }
  const version = await prisma.protocolVersion.findUnique({ where: { id: instance.ownerId } });
  if (!version) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
  return version.protocolId;
}

export async function saveSignatureAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const file = formData.get("file");
    const method = formData.get("method") === "DRAWN" ? "DRAWN" : "UPLOADED";
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose a signature image." };
    }
    if (method === "UPLOADED" && file.type !== "image/png" && file.type !== "image/jpeg") {
      return { ok: false, error: "Upload a PNG or JPG signature." };
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    await saveSignatureImage({ userId: user.id, bytes, method });
    revalidatePath("/app/account/signature");
    return null;
  } catch (error) {
    return actionError(error, "The signature could not be saved.");
  }
}

export async function sendSigningCodeAction(): Promise<ActionState> {
  try {
    const user = await requireUser();
    if (user.passwordHash) {
      return { ok: false, error: "Enter your password to confirm it is you." };
    }
    const email = await contactEmail(user.id);
    if (!email) return { ok: false, error: "This account has no contact email for a confirmation code." };
    await issueEmailCode({ email, purpose: "STEP_UP", userId: user.id });
    return null;
  } catch (error) {
    return actionError(error, "The code could not be sent.");
  }
}

export async function signFieldAction(
  input: unknown,
): Promise<{ ok: true; result: ActionResult } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    const parsed = signSchema.parse(input);
    const protocolId = await protocolForInstance(parsed.instanceId);
    await authorize(user, "protocol.view", { type: "protocol", id: protocolId });
    if (!user.passwordHash ? parsed.code : parsed.password) {
      await confirmSigningStepUp({
        userId: user.id,
        password: parsed.password,
        code: parsed.code,
      });
    }
    const meta = await auditRequestMeta({ fieldPath: parsed.fieldPath });
    await signField({
      formInstanceId: parsed.instanceId,
      fieldPath: parsed.fieldPath,
      userId: user.id,
      meta,
    });
    revalidatePath(`/app/protocols/${protocolId}`);
    revalidatePath(`/app/protocols/${protocolId}/forms`);
    return {
      ok: true,
      result: await protocolResult({ title: "Form signed.", protocolId, viewerId: user.id, target: "form" }),
    };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: "That signature could not be saved." };
    return { ok: false, message: "That signature could not be saved." };
  }
}
