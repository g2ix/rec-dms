import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { buildProtocolPackage, recordPackageDownload } from "@/server/docs/bundle";
import { cachedGeneratedPdf } from "@/server/docs/render";
import { fileResponse, errorResponse } from "@/server/docs/response";
import { AppError } from "@/server/errors";
import { protocolHeader } from "@/server/protocols/read";
import { enqueuePdfConversion } from "@/server/scan/job";
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
    if (env.pdfConverter === "gotenberg") {
      const instances = await prisma.formInstance.findMany({
        where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId },
        select: { id: true },
      });
      let waiting = false;
      for (const instance of instances) {
        if (await cachedGeneratedPdf(instance.id)) continue;
        await enqueuePdfConversion(instance.id, user.id);
        waiting = true;
      }
      if (waiting || url.searchParams.get("probe") === "1") {
        if (waiting) return NextResponse.json({ state: "pending" }, { status: 202 });
        return NextResponse.json({ state: "ready" });
      }
    } else if (url.searchParams.get("probe") === "1") {
      return NextResponse.json({ state: "ready" });
    }
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
