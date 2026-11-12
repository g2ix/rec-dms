import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { audit } from "@/server/audit";
import { prisma } from "@/server/db";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Which published versions a protocol uses. A version with no `effectiveFrom` is in effect from
 * when it was published. A scheduled one counts only for protocols created on or after its date,
 * so a protocol started earlier keeps the version it started with.
 */
export async function referenceDate(db: Db, protocolId: string | null | undefined, fallback = new Date()): Promise<Date> {
  if (!protocolId) return fallback;
  const protocol = await db.protocol.findUnique({ where: { id: protocolId }, select: { createdAt: true } });
  return protocol?.createdAt ?? fallback;
}

/** In effect at `at`: started on or before it, and not retired for protocols created by then. */
function inEffect(at: Date): Prisma.FormDefinitionWhereInput {
  return {
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }] },
      { OR: [{ retiredFrom: null }, { retiredFrom: { gt: at } }] },
    ],
  };
}

/** The published form definition a protocol uses for a code. */
export async function formDefinitionFor(db: Db, code: string, at: Date = new Date()) {
  return db.formDefinition.findFirst({
    where: { code, status: "PUBLISHED", ...inEffect(at) },
    orderBy: [{ effectiveFrom: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }, { createdAt: "desc" }],
  });
}

/** Form definition for a protocol version: the one already in use on that version, else the one in effect. */
export async function formDefinitionForVersion(db: Db, code: string, protocolVersionId: string) {
  const used = await db.formInstance.findFirst({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: protocolVersionId, formDefinition: { code } },
    orderBy: { createdAt: "asc" },
    select: { formDefinition: true },
  });
  if (used) return used.formDefinition;
  const version = await db.protocolVersion.findUnique({ where: { id: protocolVersionId }, select: { protocolId: true } });
  return formDefinitionFor(db, code, await referenceDate(db, version?.protocolId));
}

/** The published workflow version for a definition key in effect at `at`. */
export async function workflowVersionFor(db: Db, definitionKey: string, at: Date = new Date()) {
  return db.workflowVersion.findFirst({
    where: {
      status: "PUBLISHED",
      definition: { key: definitionKey },
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: at } }],
    },
    orderBy: [{ effectiveFrom: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }, { number: "desc" }],
  });
}

/** A setting value, taking a scheduled value whose date has come even before the job applies it. */
export async function settingValue(db: Db, key: string, at: Date = new Date()): Promise<unknown> {
  const scheduled = await db.settingSchedule.findFirst({
    where: { key, cancelledAt: null, appliedAt: null, effectiveFrom: { lte: at } },
    orderBy: { effectiveFrom: "desc" },
  });
  if (scheduled) return scheduled.value;
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value;
}

/**
 * Daily job. Records `form.version_effective`, `workflow.version_effective` and
 * `setting.version_effective` once for each scheduled row whose date has come, and writes a
 * scheduled setting value into `settings`. Earlier versions stay published so protocols that
 * started on them keep working.
 */
export async function applyEffectiveDates(now = new Date()): Promise<{ forms: number; workflows: number; settings: number }> {
  return prisma.$transaction(async (tx) => {
    const forms = await tx.formDefinition.findMany({
      where: { status: "PUBLISHED", effectiveFrom: { lte: now }, effectiveAnnouncedAt: null },
    });
    for (const form of forms) {
      await tx.formDefinition.update({ where: { id: form.id }, data: { effectiveAnnouncedAt: now } });
      await audit.record(tx, {
        actorUserId: null,
        action: AuditAction.formVersionEffective,
        entityType: "form_definition",
        entityId: form.id,
        diff: { code: form.code, version: form.version, effectiveFrom: form.effectiveFrom?.toISOString() ?? null },
        meta: {},
      });
    }
    const workflows = await tx.workflowVersion.findMany({
      where: { status: "PUBLISHED", effectiveFrom: { lte: now }, effectiveAnnouncedAt: null },
      include: { definition: { select: { key: true } } },
    });
    for (const version of workflows) {
      await tx.workflowVersion.update({ where: { id: version.id }, data: { effectiveAnnouncedAt: now } });
      await audit.record(tx, {
        actorUserId: null,
        action: AuditAction.workflowVersionEffective,
        entityType: "workflow_version",
        entityId: version.id,
        diff: { key: version.definition.key, number: version.number, effectiveFrom: version.effectiveFrom?.toISOString() ?? null },
        meta: {},
      });
    }
    const settings = await tx.settingSchedule.findMany({
      where: { cancelledAt: null, appliedAt: null, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: "asc" },
    });
    for (const row of settings) {
      const before = await tx.setting.findUnique({ where: { key: row.key } });
      await tx.setting.upsert({
        where: { key: row.key },
        create: { key: row.key, value: row.value as Prisma.InputJsonValue },
        update: { value: row.value as Prisma.InputJsonValue },
      });
      await tx.settingSchedule.update({ where: { id: row.id }, data: { appliedAt: now } });
      await audit.record(tx, {
        actorUserId: null,
        action: AuditAction.settingVersionEffective,
        entityType: "setting",
        entityId: row.key,
        diff: { before: (before?.value ?? null) as Prisma.InputJsonValue, after: row.value as Prisma.InputJsonValue },
        meta: {},
      });
    }
    return { forms: forms.length, workflows: workflows.length, settings: settings.length };
  });
}
