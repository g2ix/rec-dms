import { AppError } from "@/server/errors";
import { ZodError } from "zod";

export type ActionState = { ok: false; error: string } | null;

export function isNextRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function actionError(error: unknown, fallback: string): ActionState {
  if (isNextRedirect(error)) throw error;
  if (error instanceof AppError) return { ok: false, error: error.message };
  if (error instanceof ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? fallback };
  }
  return { ok: false, error: fallback };
}
