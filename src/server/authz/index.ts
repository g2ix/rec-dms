import "server-only";
import { assertBootstrapAdmin } from "@/server/auth/bootstrap";
import { AppError } from "@/server/errors";

const FORM_ACTIONS = new Set(["forms.view", "forms.edit", "forms.fill"]);

/**
 * M02 replaces the bootstrap-admin check with the `forms.edit` permission.
 * Until then, form administration and the sandbox are limited to bootstrap administrators.
 */
export async function authorize(
  user: { id: string },
  action: string,
  resource?: { type?: string; id?: string },
): Promise<void> {
  void resource;
  if (!FORM_ACTIONS.has(action)) {
    throw new AppError("FORBIDDEN", "You cannot do that.", 403);
  }
  await assertBootstrapAdmin(user.id);
}
