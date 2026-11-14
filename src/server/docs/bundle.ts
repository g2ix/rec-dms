import "server-only";
import { formAccess, releasedFile } from "@/server/revision/visibility";
import { AuditAction } from "@/lib/audit-log";
import { applyFileNamePattern, defaultFileNameSetting, officialFormFileName, PACKAGE_PARTS, type FileNameSetting } from "@/lib/docs/names";
import { copyName, mergePdfs, notePdf, zipFiles } from "@/lib/docs/package";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { convertDocxToPdf } from "@/server/docs/pdf";
import { renderFormDocument } from "@/server/docs/render";
import { AppError } from "@/server/errors";
import { getObjectBytes } from "@/server/storage";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isPdf(name: string, mime: string): boolean {
  return mime === PDF_MIME || name.toLowerCase().endsWith(".pdf");
}

function isDocx(name: string, mime: string): boolean {
  return mime === DOCX_MIME || name.toLowerCase().endsWith(".docx");
}

function extensionOf(name: string, mime: string): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0) return name.slice(dot + 1).toLowerCase();
  if (mime === PDF_MIME) return "pdf";
  if (isDocx(name, mime)) return "docx";
  return "bin";
}

async function nameSetting(): Promise<FileNameSetting> {
  const row = await prisma.setting.findUnique({ where: { key: "docs.fileNamePattern" } });
  const setting = defaultFileNameSetting();
  if (row?.value && typeof row.value === "object" && !Array.isArray(row.value)) {
    for (const [key, value] of Object.entries(row.value)) {
      if (typeof value === "string" && value.trim()) setting[key] = value;
    }
  }
  return setting;
}

export async function buildProtocolPackage(input: {
  protocolId: string;
  versionId: string;
  userId: string;
  format: "pdf" | "zip";
}): Promise<{ bytes: Buffer; fileName: string; mime: string }> {
  const version = await prisma.protocolVersion.findFirst({
    where: { id: input.versionId, protocolId: input.protocolId },
    include: { protocol: true },
  });
  if (!version) throw new AppError("NOT_FOUND", "That version was not found.", 404);
  const setting = await nameSetting();
  const instances = await prisma.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id },
    include: { formDefinition: true },
    orderBy: { createdAt: "asc" },
  });
  const uploads = await prisma.storedFile.findMany({
    where: { protocolVersionId: version.id, kind: { in: ["COVER_LETTER", "MANUSCRIPT"] } },
    orderBy: { createdAt: "desc" },
  });
  const pdfParts: Uint8Array[] = [];
  const zipParts: { name: string; bytes: Uint8Array }[] = [];

  for (const part of PACKAGE_PARTS) {
    if (part.type === "form") {
      const matches = instances.filter((item) => item.formDefinition.code === part.code);
      for (let index = 0; index < matches.length; index += 1) {
        const match = matches[index];
        if (!match) continue;
        // Proponents and advisers get only what they may open: their own copy without the
        // reviewer columns, or the release copy. A form they may not open is left out.
        const access = await formAccess(prisma, input.userId, match.id);
        if (access.kind === "denied") continue;
        const releasedCopy = access.kind === "released" ? releasedFile(access, "pdf") : null;
        if (access.kind === "released" && !releasedCopy) continue;
        const rendered = releasedCopy
          ? { bytes: Buffer.from((await getObjectBytes(releasedCopy.storageKey)).body) }
          : await renderFormDocument({
              instanceId: match.id,
              format: "pdf",
              userId: input.userId,
              ...(access.kind === "own" ? { view: "proponent" as const } : {}),
            });
        const name = copyName(
          officialFormFileName(setting, part.code, "pdf"),
          index,
          matches.length,
        );
        pdfParts.push(rendered.bytes);
        zipParts.push({ name, bytes: rendered.bytes });
      }
      continue;
    }
    const file = uploads.find((item) => item.kind === part.kind);
    if (!file) continue;
    const object = await getObjectBytes(file.storageKey);
    const bytes = Buffer.from(object.body);
    const ext = extensionOf(file.originalName, file.mime);
    const pattern = setting[part.kind] || (part.kind === "COVER_LETTER" ? "Cover Letter.{ext}" : "{name}");
    const name = applyFileNamePattern(pattern, {
      ext,
      name: file.suggestedName || file.originalName,
      code: version.protocol.code ?? "",
      title: version.protocol.title,
    });
    zipParts.push({ name, bytes });
    if (isPdf(file.originalName, file.mime)) pdfParts.push(bytes);
    else if (isDocx(file.originalName, file.mime)) {
      try {
        pdfParts.push(await convertDocxToPdf(bytes));
      } catch {
        pdfParts.push(await notePdf(`${name} is included in the ZIP. It could not be added to this PDF.`));
      }
    } else {
      pdfParts.push(await notePdf(`${name} is included in the ZIP only.`));
    }
  }

  if (pdfParts.length === 0) throw new AppError("NOT_FOUND", "There is nothing to package yet.", 404);
  const stem = (version.protocol.code || "Protocol").replace(/[\\/:*?"<>|]/g, "");
  if (input.format === "zip") {
    return {
      bytes: zipFiles(zipParts),
      fileName: `${stem} submission package.zip`,
      mime: "application/zip",
    };
  }
  return {
    bytes: Buffer.from(await mergePdfs(pdfParts)),
    fileName: `${stem} submission package.pdf`,
    mime: PDF_MIME,
  };
}

export async function recordPackageDownload(input: {
  protocolId: string;
  userId: string;
  format: string;
}): Promise<void> {
  const meta = await auditRequestMeta({ format: input.format });
  await prisma.$transaction(async (tx) => {
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileDownloaded,
      entityType: "protocol",
      entityId: input.protocolId,
      protocolId: input.protocolId,
      diff: diffOf({}, { format: input.format, package: true }),
      meta,
    });
  });
}
