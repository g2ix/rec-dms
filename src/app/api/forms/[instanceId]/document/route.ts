import { NextResponse } from "next/server";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { recordDocumentDownload, renderFormDocument } from "@/server/docs/render";
import { errorResponse, fileResponse } from "@/server/docs/response";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

export async function GET(request: Request, context: { params: Promise<{ instanceId: string }> }) {
  try {
    const user = await requireUser();
    const { instanceId } = await context.params;
    const instance = await prisma.formInstance.findUnique({
      where: { id: instanceId },
      select: { id: true, ownerType: true, ownerId: true },
    });
    if (!instance) throw new AppError("NOT_FOUND", "That form was not found.", 404);
    if (instance.ownerType === "PROTOCOL_VERSION") {
      const version = await prisma.protocolVersion.findUnique({
        where: { id: instance.ownerId },
        select: { protocolId: true },
      });
      if (!version) throw new AppError("NOT_FOUND", "That form was not found.", 404);
      await authorize(user, "protocol.download", { protocolId: version.protocolId });
    } else {
      await authorize(user, "forms.view");
    }
    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "docx";
    const inline = url.searchParams.get("disposition") === "inline";
    const rendered = await renderFormDocument({ instanceId, format, userId: user.id });
    await recordDocumentDownload({
      fileId: rendered.fileId,
      userId: user.id,
      protocolId: rendered.protocolId,
      fileName: rendered.fileName,
    });
    return fileResponse(rendered.bytes, rendered.fileName, rendered.mime, inline && format === "pdf");
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return errorResponse(error);
  }
}
