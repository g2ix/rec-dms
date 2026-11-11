import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { diffFieldValues } from "@/lib/protocols/format";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";

type Tx = Prisma.TransactionClient;

type Baseline = {
  forms: Record<string, { code: string; data: unknown }>;
  files: { id: string; kind: string; name: string }[];
};

/**
 * REOPEN_VERSION. The frozen version becomes WORKING again under the same number, so the
 * proponents can replace uploads and edit the named forms. Submitting freezes it again, and
 * that audit event lists what changed.
 */
export async function reopenVersionTx(
  tx: Tx,
  input: { protocolId: string; protocolVersionId: string; forms: string[]; actorUserId: string | null; meta: Prisma.InputJsonObject },
) {
  const version = await tx.protocolVersion.findUnique({ where: { id: input.protocolVersionId } });
  if (!version || version.protocolId !== input.protocolId) throw new AppError("NOT_FOUND", "That version was not found.", 404);
  if (version.state === "WORKING") return version;
  const working = await tx.protocolVersion.findFirst({ where: { protocolId: input.protocolId, state: "WORKING" } });
  if (working) throw new AppError("CONFLICT", "Another version of this protocol is already open for editing.", 409);
  const instances = await tx.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id },
    include: { formDefinition: { select: { code: true } } },
  });
  const files = await tx.storedFile.findMany({
    where: { protocolVersionId: version.id, kind: { in: ["MANUSCRIPT", "COVER_LETTER", "SUPPORTING", "FEE_RECEIPT"] } },
    select: { id: true, kind: true, originalName: true },
  });
  const baseline: Baseline = {
    forms: Object.fromEntries(instances.map((item) => [item.id, { code: item.formDefinition.code, data: item.data }])),
    files: files.map((file) => ({ id: file.id, kind: file.kind, name: file.originalName })),
  };
  await tx.$executeRaw`SELECT set_config('recdms.version_reopen', 'on', true)`;
  const reopened = await tx.protocolVersion.update({
    where: { id: version.id },
    data: { state: "WORKING", reopenBaseline: toJson(baseline), reopenedAt: new Date(), reopenForms: input.forms },
  });
  const editable = instances.filter((item) => input.forms.includes(item.formDefinition.code)).map((item) => item.id);
  if (editable.length > 0) {
    await tx.formInstance.updateMany({ where: { id: { in: editable } }, data: { status: "DRAFT" } });
  }
  await tx.$executeRaw`SELECT set_config('recdms.version_reopen', 'off', true)`;
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    action: AuditAction.versionReopened,
    entityType: "protocol_version",
    entityId: version.id,
    protocolId: input.protocolId,
    diff: { state: "WORKING", label: version.label, number: version.number, forms: input.forms },
    meta: input.meta,
  });
  return reopened;
}

function readBaseline(value: unknown): Baseline | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<Baseline>;
  return { forms: raw.forms ?? {}, files: Array.isArray(raw.files) ? raw.files : [] };
}

/** What changed since the version was reopened: field paths per form, and files added or removed. */
export async function reopenChanges(tx: Tx, protocolVersionId: string, stored: unknown) {
  const baseline = readBaseline(stored);
  if (!baseline) return null;
  const instances = await tx.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId },
    include: { formDefinition: { select: { code: true } } },
  });
  const forms: Record<string, string[]> = {};
  for (const instance of instances) {
    const before = baseline.forms[instance.id];
    const changes = diffFieldValues(before?.data ?? {}, instance.data);
    if (changes.length > 0) forms[instance.formDefinition.code] = changes.map((change) => change.path);
  }
  const files = await tx.storedFile.findMany({
    where: { protocolVersionId, kind: { in: ["MANUSCRIPT", "COVER_LETTER", "SUPPORTING", "FEE_RECEIPT"] } },
    select: { id: true, kind: true, originalName: true },
  });
  const before = new Set(baseline.files.map((file) => file.id));
  const after = new Set(files.map((file) => file.id));
  return {
    forms,
    filesAdded: files.filter((file) => !before.has(file.id)).map((file) => `${file.kind} ${file.originalName}`),
    filesRemoved: baseline.files.filter((file) => !after.has(file.id)).map((file) => `${file.kind} ${file.name}`),
  };
}
