import "server-only";
import type { FileKind, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { log } from "@/server/log";
import { getObjectBytes, putObject } from "@/server/storage";

type Tx = Prisma.TransactionClient;

/**
 * Uploads a new version starts with. The manuscript is not carried: a panel return asks for the
 * revised manuscript, so it is uploaded on the new version. Fee receipts belong to their bill.
 */
export const CARRIED_KINDS: readonly FileKind[] = ["COVER_LETTER", "SUPPORTING"];

/**
 * The intake of the new version starts as a copy of the last one: study scoping, COI, budget and
 * references. Actions taken start empty (they answer this round's points), and every researcher
 * agrees and signs again. The old version's intake is left as it was (it is frozen).
 */
export async function carryIntakeTx(tx: Tx, fromVersionId: string, toVersionId: string): Promise<boolean> {
  const source = await tx.protocolIntake.findUnique({ where: { protocolVersionId: fromVersionId } });
  if (!source) return false;
  const existing = await tx.protocolIntake.findUnique({ where: { protocolVersionId: toVersionId } });
  const data = {
    scoping: source.scoping ?? {},
    coi: source.coi ?? {},
    budgetLines: source.budgetLines ?? [],
    references: source.references ?? {},
    actions: {},
  } as Prisma.ProtocolIntakeUncheckedCreateInput;
  if (existing) await tx.protocolIntake.update({ where: { id: existing.id }, data: { ...data, protocolVersionId: undefined } });
  else await tx.protocolIntake.create({ data: { ...data, protocolVersionId: toVersionId } });
  return true;
}

/**
 * Copies the latest upload of each carried kind to the new version, as its own object, so the old
 * version's files are never touched. Runs after the version is created; a failure leaves that
 * kind for the proponents to upload again and is logged.
 */
export async function carryUploads(input: { protocolId: string; fromVersionId: string; toVersionId: string; userId: string; meta: Awaited<ReturnType<typeof auditRequestMeta>> }): Promise<number> {
  const files = await prisma.storedFile.findMany({
    where: { protocolVersionId: input.fromVersionId, kind: { in: [...CARRIED_KINDS] }, scanStatus: { not: "INFECTED" } },
    orderBy: { createdAt: "desc" },
  });
  const already = await prisma.storedFile.findMany({
    where: { protocolVersionId: input.toVersionId, carriedFromId: { not: null } },
    select: { carriedFromId: true },
  });
  const done = new Set(already.map((file) => file.carriedFromId));
  // Supporting files are many; the cover letter is one. Keep every supporting file, the latest of the rest.
  const seen = new Set<string>();
  const chosen = files.filter((file) => {
    if (file.kind === "SUPPORTING") return true;
    if (seen.has(file.kind)) return false;
    seen.add(file.kind);
    return true;
  });
  let carried = 0;
  for (const file of chosen) {
    if (done.has(file.id)) continue;
    try {
      const object = await getObjectBytes(file.storageKey);
      const storageKey = `protocols/${input.protocolId}/versions/${input.toVersionId}/${file.kind.toLowerCase()}/${crypto.randomUUID()}`;
      await putObject(storageKey, object.body, file.mime);
      await prisma.storedFile.create({
        data: {
          protocolVersionId: input.toVersionId,
          kind: file.kind,
          originalName: file.originalName,
          suggestedName: file.suggestedName,
          storageKey,
          mime: file.mime,
          size: file.size,
          sha256: file.sha256,
          uploadedById: file.uploadedById,
          scanStatus: file.scanStatus,
          carriedFromId: file.id,
        },
      });
      carried += 1;
    } catch (error) {
      log.error({ fileId: file.id, error: String(error) }, "revision.carry_upload_failed");
    }
  }
  if (carried > 0) {
    await prisma.$transaction(async (tx) => {
      await audit.record(tx, {
        actorUserId: input.userId,
        action: AuditAction.revisionCarried,
        entityType: "protocol_version",
        entityId: input.toVersionId,
        protocolId: input.protocolId,
        diff: diffOf({}, { files: carried }),
        meta: input.meta,
      });
    });
  }
  return carried;
}
