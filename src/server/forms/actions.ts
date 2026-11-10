"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError, z } from "zod";
import { ROLE_KEYS } from "@/lib/forms/roles";
import { actionError, isNextRedirect, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import {
  createDefinition,
  createSampleDefinition,
  createVersion,
  publishDefinition,
  retireDefinition,
  saveTemplate,
  updateDefinition,
} from "@/server/forms/definitions";
import { markComplete, reopenSandbox, setSandboxPreview, type SaveFieldResult } from "@/server/forms/fill";
import {
  authorizeFormInstance,
  saveAuthorizedField,
  saveFieldInputSchema,
  saveInputError,
} from "@/server/forms/save-input";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

const roleKeySchema = z.enum(ROLE_KEYS);

const previewSchema = z.object({
  instanceId: z.string().uuid(),
  roles: z.array(roleKeySchema).min(1).max(4),
  step: z.string().max(80).nullable(),
});

const definitionSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string(),
  title: z.string(),
  version: z.string(),
  effectiveDate: z.string(),
  schemaText: z.string().max(500_000),
});

function formError(error: unknown, fallback: string): { ok: false; message: string } {
  if (error instanceof AppError) return { ok: false, message: error.message };
  if (error instanceof ZodError) return { ok: false, message: error.issues[0]?.message ?? fallback };
  return { ok: false, message: fallback };
}

export async function saveFieldAction(input: unknown): Promise<SaveFieldResult> {
  try {
    const user = await requireUser();
    const parsed = saveFieldInputSchema.parse(input);
    await authorizeFormInstance(user, parsed.instanceId);
    return await saveAuthorizedField(user.id, parsed);
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return saveInputError(error, "Check the value and try again.");
  }
}

export async function setSandboxPreviewAction(input: unknown): Promise<{ ok: true; roles: string[]; step: string | null } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "forms.fill");
    const parsed = previewSchema.parse(input);
    const updated = await setSandboxPreview({ ...parsed, userId: user.id });
    return { ok: true, roles: updated.previewRoles, step: updated.previewStep };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return formError(error, "The preview role could not be saved.");
  }
}

export async function markCompleteAction(instanceId: string): Promise<{ ok: true } | { ok: false; message: string; errors?: { path: string; message: string }[] }> {
  try {
    const user = await requireUser();
    await authorizeFormInstance(user, instanceId);
    const result = await markComplete(instanceId, user.id);
    if (!result.ok) return { ok: false, message: "Complete the required fields first.", errors: result.errors };
    revalidatePath("/admin/forms");
    return { ok: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return formError(error, "The form could not be marked complete.");
  }
}

export async function reopenSandboxAction(instanceId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "forms.edit");
    await reopenSandbox(instanceId, user.id);
    revalidatePath("/admin/forms");
    return { ok: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return formError(error, "The sandbox could not be reopened.");
  }
}

export async function saveDefinitionAction(input: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "forms.edit");
    const parsed = definitionSchema.parse(input);
    if (!parsed.id) return { ok: false, message: "That form was not found." };
    let schema: unknown;
    try {
      schema = JSON.parse(parsed.schemaText);
    } catch {
      return { ok: false, message: "The schema is not valid JSON." };
    }
    await updateDefinition({ ...parsed, id: parsed.id, schema, userId: user.id });
    revalidatePath("/admin/forms");
    revalidatePath(`/admin/forms/${parsed.id}`);
    return { ok: true };
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return formError(error, "The draft could not be saved.");
  }
}

async function adminUser() {
  const user = await requireUser();
  await authorize(user, "forms.edit");
  return user;
}

function bounce(id: string, error: unknown, fallback: string): never {
  if (isNextRedirect(error)) throw error;
  const message = error instanceof AppError ? error.message : fallback;
  redirect(`/admin/forms/${id}?error=${encodeURIComponent(message)}`);
}

export async function createDefinitionAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await adminUser();
    const created = await createDefinition({
      code: String(formData.get("code") ?? ""),
      title: String(formData.get("title") ?? ""),
      version: String(formData.get("version") ?? ""),
      effectiveDate: String(formData.get("effectiveDate") ?? ""),
      schema: { sections: [] },
      userId: user.id,
    });
    redirect(`/admin/forms/${created.id}`);
  } catch (error) {
    return actionError(error, "The form could not be created.");
  }
}

export async function createSampleAction(): Promise<void> {
  const user = await adminUser();
  const created = await createSampleDefinition(user.id);
  redirect(`/admin/forms/${created.id}`);
}

export async function publishFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await adminUser();
    await publishDefinition(id, user.id);
    revalidatePath("/admin/forms");
    redirect(`/admin/forms/${id}`);
  } catch (error) {
    bounce(id, error, "The form could not be published.");
  }
}

export async function retireFormAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await adminUser();
    await retireDefinition(id, user.id);
    revalidatePath("/admin/forms");
    redirect(`/admin/forms/${id}`);
  } catch (error) {
    bounce(id, error, "The form could not be retired.");
  }
}

export async function saveTemplateAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await adminUser();
    const uploaded = formData.get("template");
    const file =
      uploaded instanceof File && uploaded.size > 0
        ? { name: uploaded.name, bytes: Buffer.from(await uploaded.arrayBuffer()) }
        : null;
    await saveTemplate({
      id,
      userId: user.id,
      placeholderMap: String(formData.get("placeholderMap") ?? ""),
      file,
    });
    revalidatePath(`/admin/forms/${id}`);
    redirect(`/admin/forms/${id}`);
  } catch (error) {
    bounce(id, error, "The template could not be saved.");
  }
}

export async function createVersionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await adminUser();
    const created = await createVersion(id, String(formData.get("version") ?? ""), user.id);
    revalidatePath("/admin/forms");
    redirect(`/admin/forms/${created.id}`);
  } catch (error) {
    bounce(id, error, "The new version could not be created.");
  }
}

export async function newSandboxAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  try {
    const user = await adminUser();
    await prisma.formInstance.deleteMany({
      where: { formDefinitionId: id, ownerType: "SANDBOX", ownerId: user.id },
    });
    revalidatePath(`/admin/forms/${id}/try`);
    redirect(`/admin/forms/${id}/try`);
  } catch (error) {
    bounce(id, error, "A new sandbox could not be started.");
  }
}
