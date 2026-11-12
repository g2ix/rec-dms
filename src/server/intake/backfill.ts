import "server-only";
import { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { FUNDING_KINDS, RESEARCH_TYPES, formatFunding, formatResearchType } from "@/lib/protocols/catalog";
import { audit, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { toJson } from "@/server/forms/json";
import { leadingNumber } from "@/lib/intake/parse";

export type BackfillEntry = {
  protocolId: string;
  copied: Record<string, unknown>;
  skipped: { field: string; reason: string }[];
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Copies F-27 answers of existing protocols into the protocol (Details) and the intake, only
 * where the protocol field or the intake section is still empty. Form copies are never changed.
 * Each protocol that gets a value, or has a value that could not be read, is logged as an
 * `intake.backfilled` audit event. Running it again copies nothing new.
 */
export async function backfillIntake(options: { protocolIds?: string[] } = {}): Promise<BackfillEntry[]> {
  const protocols = await prisma.protocol.findMany({
    where: options.protocolIds ? { id: { in: options.protocolIds } } : {},
    include: { versions: { orderBy: { number: "desc" }, include: { intake: true } } },
  });
  const report: BackfillEntry[] = [];
  for (const protocol of protocols) {
    const versionIds = protocol.versions.map((version) => version.id);
    if (versionIds.length === 0) continue;
    const application = await prisma.formInstance.findFirst({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: { in: versionIds }, filledByMemberId: null, formDefinition: { code: "F-27" } },
      orderBy: { updatedAt: "desc" },
      select: { data: true },
    });
    const data = isRecord(application?.data) ? application.data : null;
    if (!data) continue;

    const copied: Record<string, unknown> = {};
    const skipped: BackfillEntry["skipped"] = [];
    const update: Prisma.ProtocolUpdateInput = {};

    if (protocol.durationMonths == null && text(data.duration)) {
      const months = leadingNumber(data.duration);
      if (months != null && months > 0 && months <= 240) update.durationMonths = copied.durationMonths = months;
      else skipped.push({ field: "durationMonths", reason: `"${text(data.duration)}" has no number of months` });
    }
    if (protocol.expectedParticipants == null && text(data.participants)) {
      const count = leadingNumber(data.participants);
      if (count != null) update.expectedParticipants = copied.expectedParticipants = count;
      else skipped.push({ field: "expectedParticipants", reason: `"${text(data.participants)}" has no number` });
    }
    if (!protocol.studySite.trim() && text(data.study_site)) update.studySite = copied.studySite = text(data.study_site).slice(0, 240);

    if (protocol.researchTypeCodes.length === 0 && Array.isArray(data.research_type)) {
      const known = new Set<string>(RESEARCH_TYPES.map((type) => type.code));
      const codes = data.research_type.filter((code): code is string => typeof code === "string" && known.has(code));
      const unknown = data.research_type.filter((code) => typeof code !== "string" || !known.has(code));
      if (codes.length > 0) {
        const other = codes.includes("OTHER") ? text(data.research_type_other).slice(0, 160) : "";
        update.researchTypeCodes = codes;
        update.researchTypeOther = other;
        if (!protocol.researchType.trim()) update.researchType = formatResearchType(codes, other);
        copied.researchTypeCodes = codes;
      }
      if (unknown.length > 0) skipped.push({ field: "researchTypeCodes", reason: `not in the research type catalog: ${unknown.map(String).join(", ")}` });
    }

    const storedFunding = Array.isArray(protocol.fundingSources) ? protocol.fundingSources : [];
    if (storedFunding.length === 0 && Array.isArray(data.funds)) {
      const detailOf: Record<string, string> = { INSTITUTION: text(data.fund_institution), AGENCY: text(data.fund_agency), OTHER: text(data.fund_other) };
      const sources = FUNDING_KINDS.filter((kind) => (data.funds as unknown[]).includes(kind.code)).map((kind) => {
        const detail = kind.detail === "NONE" ? "" : (detailOf[kind.code] ?? "").slice(0, 160);
        return { code: kind.code, name: formatFunding(kind.code, detail), detail };
      });
      if (sources.length > 0) {
        update.fundingSources = toJson(sources);
        copied.fundingSources = sources.map((source) => source.code);
      }
    }
    if (text(data.fund_amounts)) skipped.push({ field: "fund_amounts", reason: "F-27 no longer has amounts; they belong on F-30" });

    const latest = protocol.versions[0]!;
    const coi = data.conflict === "NONE" ? { kind: "NONE" as const } : data.conflict === "DECLARED" ? { kind: "SPECIFY" as const, text: text(data.conflict_details).slice(0, 4000) } : null;
    const intakeCoi = latest.intake && isRecord(latest.intake.coi) ? latest.intake.coi : {};
    const copyCoi = coi && !intakeCoi.kind && !(latest.intake && latest.state === "SUBMITTED");
    if (coi && latest.intake && latest.state === "SUBMITTED" && !intakeCoi.kind) {
      skipped.push({ field: "intake.coi", reason: "the latest version is submitted and its intake is frozen" });
    }
    if (copyCoi) copied["intake.coi"] = coi;

    if (Object.keys(copied).length === 0 && skipped.length === 0) continue;
    // Running again: values that could not be read were logged the first time; log only new copies.
    if (Object.keys(copied).length === 0) {
      const logged = await prisma.auditEvent.findFirst({ where: { protocolId: protocol.id, action: AuditAction.intakeBackfilled }, select: { id: true } });
      if (logged) continue;
    }
    await prisma.$transaction(async (tx) => {
      if (Object.keys(update).length > 0) await tx.protocol.update({ where: { id: protocol.id }, data: update });
      if (copyCoi) {
        if (latest.intake) await tx.protocolIntake.update({ where: { id: latest.intake.id }, data: { coi: toJson(coi) } });
        else await tx.protocolIntake.create({ data: { protocolVersionId: latest.id, coi: toJson(coi) } });
      }
      await audit.record(tx, {
        actorUserId: null,
        action: AuditAction.intakeBackfilled,
        entityType: "protocol",
        entityId: protocol.id,
        protocolId: protocol.id,
        diff: diffOf({}, { copied: toJson(copied), skipped: toJson(skipped) } as Prisma.InputJsonObject),
        meta: { source: "F-27", script: "backfill-intake" },
      });
    });
    report.push({ protocolId: protocol.id, copied, skipped });
  }
  return report;
}
