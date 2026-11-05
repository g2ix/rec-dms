import "server-only";
import { createHash } from "node:crypto";
import type { SignatureCapture } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { prepareSignaturePng } from "@/server/signatures/image";
import { deleteObject, getObjectBytes, putObject } from "@/server/storage";

const MAX_BYTES = 4 * 1024 * 1024;

export async function saveSignatureImage(input: {
  userId: string;
  bytes: Buffer;
  method: SignatureCapture;
}) {
  if (input.bytes.length === 0) throw new AppError("INVALID", "Choose a signature image.", 400);
  if (input.bytes.length > MAX_BYTES) throw new AppError("INVALID", "That image is larger than 4 MB.", 400);
  const png = await prepareSignaturePng(input.bytes);
  const storageKey = `signatures/${input.userId}/${crypto.randomUUID()}.png`;
  const sha256 = createHash("sha256").update(png).digest("hex");
  await putObject(storageKey, png, "image/png");
  const meta = await auditRequestMeta({ method: input.method });

  try {
    return await prisma.$transaction(async (tx) => {
      await useAppSchema(tx);
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE`;
      const latest = await tx.signature.findFirst({
        where: { userId: input.userId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = (latest?.version ?? 0) + 1;
      await tx.signature.updateMany({ where: { userId: input.userId, active: true }, data: { active: false } });
      const file = await tx.storedFile.create({
        data: {
          kind: "SIGNATURE_IMAGE",
          originalName: "signature.png",
          storageKey,
          mime: "image/png",
          size: png.length,
          sha256,
          uploadedById: input.userId,
          scanStatus: "CLEAN",
        },
      });
      const signature = await tx.signature.create({
        data: {
          userId: input.userId,
          version,
          imageKey: storageKey,
          fileId: file.id,
          method: input.method,
          active: true,
        },
      });
      await audit.record(tx, {
        actorUserId: input.userId,
        action: AuditAction.signatureSaved,
        entityType: "signature",
        entityId: signature.id,
        diff: diffOf({ activeVersion: latest?.version ?? null }, { activeVersion: version, method: input.method }),
        meta,
      });
      return signature;
    });
  } catch (error) {
    await deleteObject(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function activeSignature(userId: string) {
  return prisma.signature.findFirst({
    where: { userId, active: true },
    orderBy: { version: "desc" },
    include: { file: true },
  });
}

export async function activeSignatureView(userId: string) {
  const signature = await activeSignature(userId);
  if (!signature) return null;
  let dataUrl: string | null = null;
  try {
    const object = await getObjectBytes(signature.imageKey);
    dataUrl = `data:image/png;base64,${Buffer.from(object.body).toString("base64")}`;
  } catch {
    dataUrl = null;
  }
  const older = await prisma.signature.count({ where: { userId, active: false } });
  return {
    dataUrl,
    version: signature.version,
    method: signature.method,
    createdAt: signature.createdAt,
    older,
  };
}
