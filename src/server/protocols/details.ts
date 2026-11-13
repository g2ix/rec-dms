import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { studySelectionFromForm } from "@/lib/protocols/catalog";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";
import { intakeFormsBefore, refreshIntakeForms } from "@/server/intake/service";

export const protocolDetailsSchema = z.object({
  title: z.string().trim().min(1, "Enter the protocol title.").max(300),
  institution: z.string().trim().min(1, "Enter the institution.").max(160),
  institutionAddress: z.string().trim().max(240),
  researchType: z.string().trim().min(1, "Choose at least one research type.").max(800),
  researchTypeCodes: z.array(z.string().min(1)).min(1, "Choose at least one research type."),
  researchTypeOther: z.string().trim().max(160),
  durationMonths: z.number().int().positive().max(240).nullable(),
  expectedParticipants: z.number().int().nonnegative().max(1_000_000).nullable(),
  studySite: z.string().trim().max(240),
  fundingSources: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        name: z.string().trim().min(1).max(240),
        detail: z.string().trim().max(160),
      }),
    )
    .max(8),
});

export type ProtocolDetails = z.infer<typeof protocolDetailsSchema>;

function snapshotOf(protocol: {
  title: string;
  institution: string;
  institutionAddress: string;
  researchType: string;
  researchTypeCodes: string[];
  researchTypeOther: string;
  durationMonths: number | null;
  expectedParticipants: number | null;
  studySite: string;
  fundingSources: unknown;
}) {
  return {
    title: protocol.title,
    institution: protocol.institution,
    institutionAddress: protocol.institutionAddress,
    researchType: protocol.researchType,
    researchTypeCodes: protocol.researchTypeCodes,
    researchTypeOther: protocol.researchTypeOther,
    durationMonths: protocol.durationMonths,
    expectedParticipants: protocol.expectedParticipants,
    studySite: protocol.studySite,
    fundingSources: protocol.fundingSources,
  };
}

export async function updateSharedDetails(protocolId: string, userId: string, input: ProtocolDetails) {
  const parsed = protocolDetailsSchema.parse(input);
  return writeDetails(protocolId, userId, {
    title: parsed.title,
    institution: parsed.institution,
    institutionAddress: parsed.institutionAddress,
    researchType: parsed.researchType,
    researchTypeCodes: parsed.researchTypeCodes,
    researchTypeOther: parsed.researchTypeOther,
    durationMonths: parsed.durationMonths,
    expectedParticipants: parsed.expectedParticipants,
    studySite: parsed.studySite,
    fundingSources: toJson(parsed.fundingSources),
  });
}

/**
 * One autosaved field group of the intake's Study or Funding section. Only the fields sent are
 * written, each checked on its own, so a half-filled protocol can save its title before it has a
 * research type. Same audit and F-27/F-28/F-30 refresh as the Details form.
 */
export const studyPatchSchema = z
  .object({
    title: protocolDetailsSchema.shape.title,
    institution: protocolDetailsSchema.shape.institution,
    institutionAddress: protocolDetailsSchema.shape.institutionAddress,
    researchTypeCodes: z.array(z.string()),
    researchTypeOther: z.string(),
    durationMonths: protocolDetailsSchema.shape.durationMonths,
    expectedParticipants: protocolDetailsSchema.shape.expectedParticipants,
    studySite: protocolDetailsSchema.shape.studySite,
    funding: z.array(z.object({ code: z.string(), detail: z.string() })),
  })
  .partial()
  .strict();
export type StudyPatch = z.infer<typeof studyPatchSchema>;

export async function updateStudyFields(protocolId: string, userId: string, input: StudyPatch) {
  const patch = studyPatchSchema.parse(input);
  const data: Prisma.ProtocolUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.institution !== undefined) data.institution = patch.institution;
  if (patch.institutionAddress !== undefined) data.institutionAddress = patch.institutionAddress;
  if (patch.durationMonths !== undefined) data.durationMonths = patch.durationMonths;
  if (patch.expectedParticipants !== undefined) data.expectedParticipants = patch.expectedParticipants;
  if (patch.studySite !== undefined) data.studySite = patch.studySite;
  const types = patch.researchTypeCodes !== undefined || patch.researchTypeOther !== undefined;
  if (types || patch.funding !== undefined) {
    const current = await prisma.protocol.findUnique({
      where: { id: protocolId },
      select: { researchTypeCodes: true, researchTypeOther: true, fundingSources: true },
    });
    if (!current) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
    const form = new FormData();
    // A funding-only save of a protocol with no research type yet must not fail on the type.
    const codes = patch.researchTypeCodes ?? current.researchTypeCodes;
    for (const code of types || codes.length > 0 ? codes : ["SOCIAL_BEHAVIORAL"]) form.append("researchTypeCode", code);
    form.set("researchTypeOther", patch.researchTypeOther ?? current.researchTypeOther);
    for (const source of patch.funding ?? storedFunding(current.fundingSources)) {
      form.append("fundingCode", source.code);
      form.set(`fundingDetail_${source.code}`, source.detail);
    }
    const study = studySelectionFromForm(form);
    if (types) {
      data.researchType = study.researchType;
      data.researchTypeCodes = study.researchTypeCodes;
      data.researchTypeOther = study.researchTypeOther;
    }
    if (patch.funding !== undefined) data.fundingSources = toJson(study.fundingSources);
  }
  return writeDetails(protocolId, userId, data);
}

function storedFunding(value: unknown): { code: string; detail: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as { code?: unknown; detail?: unknown };
    return typeof row.code === "string" ? [{ code: row.code, detail: typeof row.detail === "string" ? row.detail : "" }] : [];
  });
}

async function writeDetails(protocolId: string, userId: string, data: Prisma.ProtocolUpdateInput) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const member = await tx.protocolMember.findFirst({ where: { protocolId, userId, status: "ACTIVE" } });
    if (!member || (member.role !== "PROPONENT" && member.role !== "ADVISER")) {
      throw new AppError("FORBIDDEN", "You cannot edit this protocol.", 403);
    }
    const working = await tx.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
    if (!working) throw new AppError("LOCKED", "This version is submitted and cannot be edited.", 409);
    const before = await tx.protocol.findUnique({ where: { id: protocolId } });
    if (!before) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
    const formsBefore = await intakeFormsBefore(tx, working.id);
    const updated = await tx.protocol.update({ where: { id: protocolId }, data });
    await audit.record(tx, {
      actorUserId: userId,
      actingRole: member.isLeader ? "PROJECT_LEADER" : member.role,
      action: AuditAction.protocolUpdated,
      entityType: "protocol",
      entityId: protocolId,
      protocolId,
      diff: diffOf(snapshotOf(before), snapshotOf(updated)),
      meta,
    });
    // F-27, F-28 and F-30 of an intake version print these details: refresh their prints and signatures.
    const reason =
      before.title !== updated.title
        ? "the study title changed"
        : JSON.stringify(before.fundingSources) !== JSON.stringify(updated.fundingSources)
          ? "the sources of funds changed"
          : "the study details changed";
    await refreshIntakeForms(tx, { versionId: working.id, before: formsBefore, protocolId, actorUserId: userId, meta, reason });
    return updated;
  });
}

export async function changePanel(protocolId: string, actorUserId: string, panelId: string) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const panel = await tx.panel.findUnique({ where: { id: panelId } });
    if (!panel || !panel.active) throw new AppError("NOT_FOUND", "That panel was not found.", 404);
    const before = await tx.protocol.findUnique({ where: { id: protocolId } });
    if (!before) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
    await tx.protocol.update({ where: { id: protocolId }, data: { panelId: panel.id } });
    await audit.record(tx, {
      actorUserId,
      actingRole: "REC_STAFF",
      action: AuditAction.panelChanged,
      entityType: "protocol",
      entityId: protocolId,
      protocolId,
      diff: diffOf({ panelId: before.panelId }, { panelId: panel.id }),
      meta,
    });
  });
}
