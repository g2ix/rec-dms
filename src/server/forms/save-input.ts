import "server-only";
import { ZodError, z } from "zod";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { saveField, type SaveFieldResult } from "@/server/forms/fill";

export const saveFieldInputSchema = z.object({
  instanceId: z.string().uuid(),
  path: z.string().min(1).max(240),
  value: z.unknown().optional().transform((value) => value ?? null),
  expectedRevision: z.number().int().nonnegative(),
});

export const keepaliveFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        path: z.string().min(1).max(240),
        value: z.unknown().optional().transform((value) => value ?? null),
      }),
    )
    .min(1)
    .max(100),
  expectedRevision: z.number().int().nonnegative(),
});

export async function authorizeFormInstance(user: { id: string }, instanceId: string) {
  const instance = await prisma.formInstance.findUnique({
    where: { id: instanceId },
    include: { formDefinition: { select: { code: true } } },
  });
  if (!instance) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
  if (instance.ownerType === "SANDBOX") {
    await authorize(user, "forms.fill");
    if (instance.ownerId !== user.id) throw new AppError("FORBIDDEN", "You cannot edit that sandbox.", 403);
    return;
  }
  const version = await prisma.protocolVersion.findUnique({ where: { id: instance.ownerId } });
  if (!version) throw new AppError("NOT_FOUND", "That form copy was not found.", 404);
  const { editingStepFor } = await import("@/server/workflow/access");
  const step = await editingStepFor(prisma, user.id, version.id, instance.formDefinition.code);
  if (step) return;
  await authorize(user, "protocol.fill", { type: "protocol", id: version.protocolId });
}

function tooLong(value: unknown): boolean {
  try {
    return JSON.stringify(value ?? null).length > 200_000;
  } catch {
    return true;
  }
}

/** Same checks as saveFieldAction, then saveField. */
export async function saveAuthorizedField(
  userId: string,
  input: { instanceId: string; path: string; value: unknown; expectedRevision: number },
): Promise<SaveFieldResult> {
  const value = input.value ?? null;
  if (tooLong(value)) {
    return { ok: false, code: "INVALID", message: "That value is too long." };
  }
  return saveField({
    instanceId: input.instanceId,
    path: input.path,
    expectedRevision: input.expectedRevision,
    value,
    userId,
  });
}

/** Saves pending fields in order, advancing the revision after each success (keepalive / beacon). */
export async function saveAuthorizedFieldsKeepalive(
  userId: string,
  instanceId: string,
  input: { fields: { path: string; value: unknown }[]; expectedRevision: number },
): Promise<{ ok: true; revision: number } | { ok: false; code: string; message: string }> {
  let revision = input.expectedRevision;
  for (const field of input.fields) {
    const result = await saveAuthorizedField(userId, {
      instanceId,
      path: field.path,
      value: field.value,
      expectedRevision: revision,
    });
    if (result.ok) {
      revision = result.revision;
      continue;
    }
    if (result.code === "CONFLICT" && "revision" in result) {
      revision = result.revision;
      // Retry once against the newer revision so unload still lands the last edit when possible.
      const retry = await saveAuthorizedField(userId, {
        instanceId,
        path: field.path,
        value: field.value,
        expectedRevision: revision,
      });
      if (retry.ok) {
        revision = retry.revision;
        continue;
      }
      return {
        ok: false,
        code: retry.code,
        message: "message" in retry ? retry.message : "That field could not be saved.",
      };
    }
    return {
      ok: false,
      code: result.code,
      message: "message" in result ? result.message : "That field could not be saved.",
    };
  }
  return { ok: true, revision };
}

export function saveInputError(error: unknown, fallback: string): { ok: false; code: string; message: string } {
  if (error instanceof AppError) return { ok: false, code: error.code, message: error.message };
  if (error instanceof ZodError) {
    return { ok: false, code: "INVALID", message: error.issues[0]?.message ?? fallback };
  }
  throw error;
}
