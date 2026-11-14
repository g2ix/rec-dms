import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { readJsonBody } from "@/server/request-body";
import { isIntakeSection, saveIntakeSection } from "@/server/intake/service";
import { requireUser } from "@/server/session";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  fields: z.array(z.object({ path: z.string().min(1).max(40), value: z.unknown() })).min(1).max(10),
  expectedRevision: z.number().int().nonnegative(),
});

/**
 * Keepalive / sendBeacon save of pending intake sections when the page hides or unloads.
 * Authorization and validation match saveIntakeAction.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await authorize(user, "protocol.edit", { type: "protocol", id });
    const body = bodySchema.parse(await readJsonBody(request));
    let revision = body.expectedRevision;
    for (const field of body.fields) {
      if (!isIntakeSection(field.path)) throw new AppError("INVALID", "That intake section does not exist.", 400);
      const result = await saveIntakeSection({ protocolId: id, userId: user.id, section: field.path, value: field.value, expectedRevision: revision });
      if (!result.ok) return NextResponse.json(result, { status: 409 });
      revision = result.revision;
    }
    return NextResponse.json({ ok: true, revision });
  } catch (error) {
    if (error instanceof AppError) {
      const status =
        error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "LOCKED" ? 409 : 400;
      return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ ok: false, code: "INVALID", message: error.issues[0]?.message ?? "Check the answers and try again." }, { status: 400 });
    }
    throw error;
  }
}
