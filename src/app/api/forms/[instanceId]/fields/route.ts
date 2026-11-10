import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/server/errors";
import {
  authorizeFormInstance,
  keepaliveFieldsSchema,
  saveAuthorizedFieldsKeepalive,
} from "@/server/forms/save-input";
import { requireUser } from "@/server/session";

type Params = { params: Promise<{ instanceId: string }> };

/**
 * Keepalive / sendBeacon save for pending form fields when the page hides or unloads.
 * Authorization and validation match saveFieldAction.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { instanceId } = await params;
    await authorizeFormInstance(user, instanceId);
    const body = keepaliveFieldsSchema.parse(await request.json().catch(() => null));
    const result = await saveAuthorizedFieldsKeepalive(user.id, instanceId, body);
    if (!result.ok) {
      return NextResponse.json(result, { status: result.code === "CONFLICT" ? 409 : 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AppError) {
      const status =
        error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { ok: false, code: "INVALID", message: error.issues[0]?.message ?? "Check the value and try again." },
        { status: 400 },
      );
    }
    throw error;
  }
}
