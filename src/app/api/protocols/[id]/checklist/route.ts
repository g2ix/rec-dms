import { NextResponse } from "next/server";
import { authorize } from "@/server/authz";
import { errorResponse } from "@/server/docs/response";
import { getSubmissionChecklist } from "@/server/protocols/checklist";
import { requireUser } from "@/server/session";

/** The "Before you can submit" checklist, refetched by protocol pages as the person moves between tabs. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await authorize(user, "protocol.view", { protocolId: id });
    const checklist = await getSubmissionChecklist(user.id, id);
    return NextResponse.json({ checklist }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
