import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { buildProtocolPackage, recordPackageDownload } from "@/server/docs/bundle";
import { cachedGeneratedPdf, PROPONENT_VIEW_VARIANT } from "@/server/docs/render";
import { formAccess } from "@/server/revision/visibility";
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
      // Check the same copy the package will use, or the build converts forms inline and
      // runs past the function's time limit. Proponents (staff who lead the study included)
      // get their own proponent-view copy; released copies and hidden forms need no render.
      let waiting = false;
      for (const instance of instances) {
        const access = await formAccess(prisma, user.id, instance.id);
        if (access.kind === "denied" || access.kind === "released") continue;
        const own = access.kind === "own";
        if (await cachedGeneratedPdf(instance.id, own ? PROPONENT_VIEW_VARIANT : null)) continue;
        await enqueuePdfConversion(instance.id, user.id, own ? "proponent" : undefined);
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
