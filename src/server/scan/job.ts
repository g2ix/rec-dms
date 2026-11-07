import "server-only";
import { AuditAction } from "@/lib/audit-log";
import { bootstrapAdminEmails } from "@/server/auth/bootstrap";
import { audit, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { recordNotice } from "@/server/notifications/deliver";
import { containsEicar } from "@/server/scan/eicar";
import { scanBytes } from "@/server/scan/clamav";
import { deleteObject, getObjectBytes } from "@/server/storage";
import { env } from "@/lib/env";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function enqueueFileScan(fileId: string, at = new Date()): Promise<void> {
  const open = await prisma.job.findFirst({
    where: { kind: "SCAN_FILE", doneAt: null, payload: { path: ["fileId"], equals: fileId } },
    select: { id: true },
  });
  if (open) return;
  await prisma.job.create({
    data: {
      kind: "SCAN_FILE",
      payload: { fileId, startedAt: at.toISOString() },
      runAt: at,
    },
  });
}

export async function enqueuePdfConversion(instanceId: string, userId: string): Promise<void> {
  const open = await prisma.job.findFirst({
    where: { kind: "CONVERT_PDF", doneAt: null, payload: { path: ["instanceId"], equals: instanceId } },
    select: { id: true },
  });
  if (open) return;
  await prisma.job.create({
    data: { kind: "CONVERT_PDF", payload: { instanceId, userId }, runAt: new Date() },
  });
}

/**
 * Scan one stored file. Returns "retry" when the scanner should be tried again.
 * After 24 hours of failure the file stays PENDING and an administrator is told.
 */
export async function processFileScan(fileId: string, startedAt: string): Promise<"done" | "retry" | "gone"> {
  const file = await prisma.storedFile.findUnique({
    where: { id: fileId },
    include: { protocolVersion: { select: { protocolId: true } } },
  });
  if (!file || file.scanStatus !== "PENDING") return "done";

  let bytes: Uint8Array;
  try {
    bytes = (await getObjectBytes(file.storageKey)).body;
  } catch {
    return "gone";
  }

  if (!env.CLAMAV_URL) {
    if (containsEicar(bytes)) await markInfected(file, "EICAR");
    return "done";
  }

  try {
    const result = await scanBytes(bytes);
    if (result.clean) {
      await prisma.storedFile.update({ where: { id: file.id }, data: { scanStatus: "CLEAN" } });
      return "done";
    }
    await markInfected(file, result.signature ?? "infected");
    return "done";
  } catch (error) {
    const started = Date.parse(startedAt);
    if (Number.isFinite(started) && Date.now() - started >= DAY_MS) {
      await notifyScannerDown();
      return "done";
    }
    throw error;
  }
}

async function markInfected(
  file: {
    id: string;
    storageKey: string;
    originalName: string;
    uploadedById: string;
    protocolVersion: { protocolId: string } | null;
  },
  signature: string,
): Promise<void> {
  const protocolId = file.protocolVersion?.protocolId ?? null;
  const staff = await recStaffIds();
  await prisma.$transaction(async (tx) => {
    await tx.storedFile.update({ where: { id: file.id }, data: { scanStatus: "INFECTED" } });
    await audit.record(tx, {
      actorUserId: file.uploadedById,
      action: AuditAction.fileInfected,
      entityType: "file",
      entityId: file.id,
      protocolId,
      diff: diffOf({}, { originalName: file.originalName, signature }),
      meta: { signature },
    });
    await recordNotice(tx, {
      userIds: [...new Set([file.uploadedById, ...staff])],
      templateKey: "file.infected",
      protocolId,
      link: protocolId ? `/app/protocols/${protocolId}/uploads` : "/app",
      variables: { reason: signature },
      email: true,
    });
  });
  await deleteObject(file.storageKey).catch(() => undefined);
}

async function notifyScannerDown(): Promise<void> {
  const recent = await prisma.notification.findFirst({
    where: { type: "scan.unavailable", createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    select: { id: true },
  });
  if (recent) return;
  const userIds = await systemAdminIds();
  if (userIds.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await recordNotice(tx, {
      userIds,
      templateKey: "scan.unavailable",
      link: "/admin/audit",
      variables: {},
      email: true,
    });
  });
}

async function recStaffIds(): Promise<string[]> {
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { key: "REC_STAFF" } },
    select: { userId: true },
  });
  return [...new Set([...grants.map((grant) => grant.userId), ...(await bootstrapUserIds())])];
}

async function systemAdminIds(): Promise<string[]> {
  const grants = await prisma.userRole.findMany({
    where: { revokedAt: null, role: { key: "SYSTEM_ADMIN" } },
    select: { userId: true },
  });
  return [...new Set([...grants.map((grant) => grant.userId), ...(await bootstrapUserIds())])];
}

async function bootstrapUserIds(): Promise<string[]> {
  const emails = bootstrapAdminEmails();
  if (emails.length === 0) return [];
  const rows = await prisma.userEmail.findMany({
    where: { email: { in: emails }, verifiedAt: { not: null } },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}
