import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { formatFormalName } from "@/lib/display-name";
import { formatManila } from "@/lib/time";
import { audit, diffOf } from "@/server/audit";
import { AppError } from "@/server/errors";
import { toJson } from "@/server/forms/json";

type MemberRow = {
  role: string;
  status: string;
  rosterOrder: number;
  contactNumber: string | null;
  designation: string;
  user: {
    displayName: string;
    title?: string | null;
    firstName?: string;
    middleName?: string | null;
    middleInitial?: string | null;
    familyName?: string;
    suffix?: string | null;
    credentials?: string[] | null;
  } | null;
  contactEmail: { email: string } | null;
};

function researcherName(user: MemberRow["user"]): string {
  if (!user) return "";
  if (!user.firstName || !user.familyName) return user.displayName;
  return formatFormalName({
    title: user.title,
    firstName: user.firstName,
    middleName: user.middleName,
    middleInitial: user.middleInitial,
    familyName: user.familyName,
    suffix: user.suffix,
    credentials: user.credentials,
  });
}

export function sharedSnapshot(
  protocol: {
    code: string | null;
    title: string;
    institution: string;
    institutionAddress: string;
    researchType: string;
    researchTypeCodes?: string[];
    researchTypeOther?: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    fundingSources: Prisma.JsonValue;
    disciplineId: string | null;
    panelId: string | null;
    members: MemberRow[];
  },
  label: string,
  submittedAt: Date | null,
) {
  const proponents = protocol.members
    .filter((member) => member.role === "PROPONENT" && member.status === "ACTIVE" && member.user)
    .sort((a, b) => a.rosterOrder - b.rosterOrder);
  return {
    "protocol.code": protocol.code,
    "protocol.title": protocol.title,
    "protocol.versionLabel": label,
    "protocol.researchers": proponents.map((member) => researcherName(member.user)),
    "protocol.contactNumbers": proponents.map((member) => member.contactNumber).filter((value): value is string => Boolean(value)),
    "protocol.emails": proponents.map((member) => member.contactEmail?.email).filter((value): value is string => Boolean(value)),
    "protocol.institution": protocol.institution,
    "protocol.institutionAddress": protocol.institutionAddress,
    "protocol.submissionDate": submittedAt ? formatManila(submittedAt, "yyyy-MM-dd") : null,
    researchType: protocol.researchType,
    researchTypeCodes: protocol.researchTypeCodes ?? [],
    researchTypeOther: protocol.researchTypeOther ?? "",
    durationMonths: protocol.durationMonths,
    expectedParticipants: protocol.expectedParticipants,
    studySite: protocol.studySite,
    fundingSources: protocol.fundingSources,
    disciplineId: protocol.disciplineId,
    panelId: protocol.panelId,
  };
}

type Tx = Prisma.TransactionClient;

/** Locks the working version. A second call, after a return to the proponent, leaves the frozen version as it is. */
export async function freezeWorkingVersion(
  tx: Tx,
  input: { protocolId: string; userId: string; meta: Prisma.InputJsonObject; status?: string },
): Promise<{ versionId: string; label: string; already: boolean }> {
  const version = await tx.protocolVersion.findFirst({
    where: { protocolId: input.protocolId, state: "WORKING" },
  });
  if (!version) {
    const submitted = await tx.protocolVersion.findFirst({
      where: { protocolId: input.protocolId, state: "SUBMITTED" },
      orderBy: { number: "desc" },
    });
    if (!submitted) throw new AppError("NOT_FOUND", "There is no working version to snapshot.", 404);
    return { versionId: submitted.id, label: submitted.label, already: true };
  }
  const protocol = await tx.protocol.findUniqueOrThrow({
    where: { id: input.protocolId },
    include: { members: { include: { user: true, contactEmail: true } } },
  });
  const submittedAt = new Date();
  const snapshot = sharedSnapshot(protocol, version.label, submittedAt);
  await tx.protocolVersion.update({
    where: { id: version.id },
    data: {
      state: "SUBMITTED",
      submittedAt,
      submittedById: input.userId,
      snapshot: toJson(snapshot),
    },
  });
  await tx.formInstance.updateMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id, status: { not: "LOCKED" } },
    data: { status: "LOCKED" },
  });
  await tx.protocol.update({
    where: { id: input.protocolId },
    data: { status: input.status ?? "SUBMITTED" },
  });
  await audit.record(tx, {
    actorUserId: input.userId,
    actingRole: "PROJECT_LEADER",
    action: AuditAction.versionSubmitted,
    entityType: "protocol_version",
    entityId: version.id,
    protocolId: input.protocolId,
    diff: diffOf(
      { state: "WORKING", status: protocol.status },
      { state: "SUBMITTED", status: input.status ?? "SUBMITTED", label: version.label },
    ),
    meta: input.meta,
  });
  return { versionId: version.id, label: version.label, already: false };
}
