import "server-only";
import { z } from "zod";
import { AuditAction } from "@/lib/audit-log";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";

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
    const updated = await tx.protocol.update({
      where: { id: protocolId },
      data: {
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
      },
    });
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
