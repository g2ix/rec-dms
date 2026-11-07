import "server-only";
import { createHash } from "node:crypto";
import type { FileKind } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { suggestedManuscriptName } from "@/lib/protocols/format";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isCommitteeStaff } from "@/server/authz/staff";
import { containsEicar } from "@/server/scan/eicar";
import { deleteObject, getObjectBytes, getSignedDownloadUrl, getSignedUploadUrl } from "@/server/storage";
import { maxUploadBytes } from "@/server/protocols/settings";

const PDF = "application/pdf";
const RECEIPT_MIMES = new Set([PDF, "image/jpeg", "image/png", "image/webp"]);
const UPLOAD_KINDS = new Set<FileKind>(["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT", "SUPPORTING"]);

export function mimeAllowed(kind: FileKind, mime: string): boolean {
  if (kind === "MANUSCRIPT" || kind === "COVER_LETTER") return mime === PDF;
  if (kind === "FEE_RECEIPT" || kind === "SUPPORTING") return RECEIPT_MIMES.has(mime);
  return false;
}

function assertKind(kind: string): FileKind {
  if (!UPLOAD_KINDS.has(kind as FileKind)) {
    throw new AppError("INVALID", "That file kind cannot be uploaded here.", 400);
  }
  return kind as FileKind;
}

async function workingVersion(protocolId: string) {
  const version = await prisma.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
  if (!version) throw new AppError("LOCKED", "This version is submitted. Start a revision before uploading.", 409);
  return version;
}

export async function prepareUpload(input: {
  protocolId: string;
  userId: string;
  kind: string;
  originalName: string;
  mime: string;
}) {
  const kind = assertKind(input.kind);
  const mime = input.mime.trim().toLowerCase();
  if (!mimeAllowed(kind, mime)) {
    throw new AppError("INVALID", "Upload a PDF. A fee receipt may also be a JPEG, PNG, or WebP image.", 400);
  }
  const originalName = input.originalName.trim().slice(0, 180);
  if (!originalName) throw new AppError("INVALID", "Choose a file.", 400);
  const version = await workingVersion(input.protocolId);
  const suggestedName = kind === "MANUSCRIPT" ? suggestedManuscriptName(version.label) : null;
  const storageKey = `protocols/${input.protocolId}/versions/${version.id}/${kind.toLowerCase()}/${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const intent = await prisma.uploadIntent.create({
    data: {
      protocolVersionId: version.id,
      kind,
      storageKey,
      originalName,
      suggestedName,
      mime,
      uploadedById: input.userId,
      expiresAt,
    },
  });
  const url = await getSignedUploadUrl(storageKey, mime, 15 * 60);
  return { intentId: intent.id, url, storageKey, suggestedName, headers: { "Content-Type": mime } };
}

export async function confirmUpload(input: { intentId: string; userId: string }) {
  const intent = await prisma.uploadIntent.findUnique({ where: { id: input.intentId } });
  if (!intent || intent.uploadedById !== input.userId) {
    throw new AppError("NOT_FOUND", "That upload was not found.", 404);
  }
  if (intent.expiresAt.getTime() < Date.now()) {
    await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
    throw new AppError("EXPIRED", "That upload expired. Choose the file again.", 400);
  }
  const version = await prisma.protocolVersion.findUnique({ where: { id: intent.protocolVersionId } });
  if (!version || version.state !== "WORKING") {
    throw new AppError("LOCKED", "This version is submitted and cannot take new files.", 409);
  }
  let bytes: Uint8Array;
  try {
    const object = await getObjectBytes(intent.storageKey);
    bytes = object.body;
  } catch {
    throw new AppError("NOT_FOUND", "The file did not arrive. Try the upload again.", 400);
  }
  const limit = await maxUploadBytes();
  if (bytes.byteLength > limit) {
    await deleteObject(intent.storageKey).catch(() => undefined);
    await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
    throw new AppError("INVALID", "That file is larger than the upload limit.", 400);
  }
  const sniffed = await sniffedMime(bytes);
  const eicar = containsEicar(bytes);
  if (!eicar && sniffed !== intent.mime) {
    await deleteObject(intent.storageKey).catch(() => undefined);
    await prisma.uploadIntent.delete({ where: { id: intent.id } }).catch(() => undefined);
    throw new AppError(
      "INVALID",
      "That file's contents do not match its type. Upload a PDF. A fee receipt may also be a JPEG, PNG, or WebP image.",
      400,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const meta = await auditRequestMeta({ kind: intent.kind, originalName: intent.originalName, sha256 });
  return prisma.$transaction(async (tx) => {
    const file = await tx.storedFile.create({
      data: {
        protocolVersionId: version.id,
        kind: intent.kind,
        originalName: intent.originalName,
        suggestedName: intent.suggestedName,
        storageKey: intent.storageKey,
        mime: intent.mime,
        size: bytes.byteLength,
        sha256,
        uploadedById: input.userId,
        scanStatus: "PENDING",
      },
    });
    if (intent.kind === "FEE_RECEIPT") {
      await tx.feeVerification.upsert({
        where: { protocolVersionId: version.id },
        create: { protocolVersionId: version.id, status: "PENDING" },
        update: { status: "PENDING", reason: null, verifiedById: null, verifiedAt: null },
      });
    }
    await tx.uploadIntent.delete({ where: { id: intent.id } });
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileUploaded,
      entityType: "file",
      entityId: file.id,
      protocolId: version.protocolId,
      diff: diffOf({}, { kind: file.kind, originalName: file.originalName, suggestedName: file.suggestedName, sha256, size: file.size }),
      meta,
    });
    await tx.job.create({
      data: {
        kind: "SCAN_FILE",
        payload: { fileId: file.id, startedAt: new Date().toISOString() },
        runAt: new Date(),
      },
    });
    return file;
  });
}

async function sniffedMime(bytes: Uint8Array): Promise<string | null> {
  const { fileTypeFromBuffer } = await import("file-type");
  const found = await fileTypeFromBuffer(bytes);
  if (!found) return null;
  if (found.mime === "application/pdf") return "application/pdf";
  if (found.mime === "image/jpeg" || found.mime === "image/png" || found.mime === "image/webp") return found.mime;
  return found.mime;
}

export async function downloadFile(input: { fileId: string; userId: string }) {
  const file = await prisma.storedFile.findUnique({
    where: { id: input.fileId },
    include: { protocolVersion: true },
  });
  if (!file?.protocolVersion) throw new AppError("NOT_FOUND", "That file was not found.", 404);
  if (file.scanStatus === "INFECTED") {
    throw new AppError("INFECTED", "This file was blocked because the virus scan found a threat.", 403);
  }
  const staff = await isCommitteeStaff(input.userId);
  if (file.scanStatus === "PENDING" && !staff) {
    throw new AppError(
      "PENDING_SCAN",
      "This file is waiting for a virus scan. REC Staff can open it, with a warning, until the scan finishes.",
      403,
    );
  }
  const meta = await auditRequestMeta({ storageKey: file.storageKey });
  await prisma.$transaction(async (tx) => {
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.fileDownloaded,
      entityType: "file",
      entityId: file.id,
      protocolId: file.protocolVersion?.protocolId,
      diff: diffOf({}, { originalName: file.originalName, kind: file.kind }),
      meta,
    });
  });
  const url = await getSignedDownloadUrl(file.storageKey, 300);
  const warning =
    file.scanStatus === "PENDING" ? "This file has not been scanned yet. Open it only if you trust the source." : null;
  return { url, file, warning };
}
