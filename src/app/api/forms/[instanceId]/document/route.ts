import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { isCommitteeStaff } from "@/server/authz/staff";
import { cachedGeneratedPdf, PROPONENT_VIEW_VARIANT, proponentCopyOf, recordDocumentDownload, renderFormDocument } from "@/server/docs/render";
import { releasedFile, requireFormAccess } from "@/server/revision/visibility";
import { getObjectBytes } from "@/server/storage";
import { errorResponse, fileResponse } from "@/server/docs/response";
import { AppError } from "@/server/errors";
import { enqueuePdfConversion } from "@/server/scan/job";
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
    const probe = url.searchParams.get("probe") === "1";
    const access = instance.ownerType === "PROTOCOL_VERSION" ? await requireFormAccess(prisma, user.id, instanceId) : ({ kind: "full" } as const);
    if (access.kind === "released") {
      const file = releasedFile(access, format);
      if (!file) throw new AppError("NOT_FOUND", "That copy was not sent to you.", 404);
      if (probe) return NextResponse.json({ state: "ready" });
      const object = await getObjectBytes(file.storageKey);
      await recordDocumentDownload({ fileId: file.id, userId: user.id, protocolId: null, fileName: file.originalName });
      return fileResponse(Buffer.from(object.body), file.suggestedName || file.originalName, file.mime, inline && format === "pdf");
    }
    if (access.kind === "legacy" && !(await isCommitteeStaff(user.id))) {
      const released = await proponentCopyOf(instanceId, format);
      if (released && !released.allowed) throw new AppError("NOT_FOUND", "That form was not sent to you.", 404);
      if (released?.file) {
        if (probe) return NextResponse.json({ state: "ready" });
        const object = await getObjectBytes(released.file.storageKey);
        await recordDocumentDownload({ fileId: released.file.id, userId: user.id, protocolId: null, fileName: released.file.originalName });
        return fileResponse(Buffer.from(object.body), released.file.suggestedName || released.file.originalName, released.file.mime, inline && format === "pdf");
      }
    }
    // The proponents' own copy prints without the columns hidden from their roles.
    const view = access.kind === "own" ? ({ view: "proponent" } as const) : {};
    if (format === "pdf" && env.pdfConverter === "gotenberg" && !(await cachedGeneratedPdf(instanceId, access.kind === "own" ? PROPONENT_VIEW_VARIANT : null))) {
      await enqueuePdfConversion(instanceId, user.id, access.kind === "own" ? "proponent" : undefined);
      return NextResponse.json({ state: "pending" }, { status: 202 });
    }
    if (probe) {
      await renderFormDocument({ instanceId, format, userId: user.id, ...view });
      return NextResponse.json({ state: "ready" });
    }
    const rendered = await renderFormDocument({ instanceId, format, userId: user.id, ...view });
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
