import { NextResponse } from "next/server";
import { authorize } from "@/server/authz";
import { buildProtocolPackage, recordPackageDownload } from "@/server/docs/bundle";
import { fileResponse, errorResponse } from "@/server/docs/response";
import { AppError } from "@/server/errors";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    await authorize(user, "protocol.download", { protocolId: id });
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "zip" ? "zip" : "pdf";
    const requested = url.searchParams.get("version");
    const header = await protocolHeader(user.id, id);
    const versionId = requested || header.shown?.id;
    if (!versionId) throw new AppError("NOT_FOUND", "This protocol has no version to package.", 404);
    const packed = await buildProtocolPackage({
      protocolId: id,
      versionId,
      userId: user.id,
      format,
    });
    await recordPackageDownload({ protocolId: id, userId: user.id, format });
    return fileResponse(packed.bytes, packed.fileName, packed.mime, false);
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return errorResponse(error);
  }
}
