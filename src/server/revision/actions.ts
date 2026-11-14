"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isNextRedirect } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { addDraftNote, answerNote, removeDraftNote } from "@/server/revision/notes";
import { requireUser } from "@/server/session";

type Result = { ok: true } | { ok: false; message: string };

function failure(error: unknown, fallback: string): Result {
  if (isNextRedirect(error)) throw error;
  if (error instanceof AppError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, message: fallback };
  return { ok: false, message: fallback };
}

const addSchema = z.object({ protocolId: z.string().uuid(), anchor: z.string().min(1).max(60), body: z.string().max(4000) });

/** The adviser, REC Staff or the chair pins a comment to a section before returning. */
export async function addReturnNoteAction(input: unknown): Promise<Result> {
  try {
    const user = await requireUser();
    const parsed = addSchema.parse(input);
    // Seeing the protocol is the gate here; the service then admits only the person holding a step that can return it.
    await authorize(user, "protocol.view", { type: "protocol", id: parsed.protocolId });
    await addDraftNote({ userId: user.id, ...parsed });
    revalidatePath(`/app/protocols/${parsed.protocolId}`);
    return { ok: true };
  } catch (error) {
    return failure(error, "The comment could not be added.");
  }
}

const removeSchema = z.object({ protocolId: z.string().uuid(), noteId: z.string().uuid() });

export async function removeReturnNoteAction(input: unknown): Promise<Result> {
  try {
    const user = await requireUser();
    const parsed = removeSchema.parse(input);
    await authorize(user, "protocol.view", { type: "protocol", id: parsed.protocolId });
    await removeDraftNote({ userId: user.id, noteId: parsed.noteId });
    revalidatePath(`/app/protocols/${parsed.protocolId}`);
    return { ok: true };
  } catch (error) {
    return failure(error, "The comment could not be removed.");
  }
}

const answerSchema = z.object({ protocolId: z.string().uuid(), noteId: z.string().uuid(), done: z.boolean(), reply: z.string().max(4000) });

/** A proponent ticks a return comment Done and may reply. */
export async function answerReturnNoteAction(input: unknown): Promise<Result> {
  try {
    const user = await requireUser();
    const parsed = answerSchema.parse(input);
    await authorize(user, "protocol.edit", { type: "protocol", id: parsed.protocolId });
    await answerNote({ userId: user.id, noteId: parsed.noteId, done: parsed.done, reply: parsed.reply });
    revalidatePath(`/app/protocols/${parsed.protocolId}/intake`);
    return { ok: true };
  } catch (error) {
    return failure(error, "Your answer could not be saved.");
  }
}
