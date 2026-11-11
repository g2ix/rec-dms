import "server-only";
import { isRoleKey } from "@/lib/forms/roles";
import { validateSchema } from "@/lib/forms/schema";
import { formProgress, type FormProgress } from "@/lib/protocols/format";
import { isReviewerRole, seesReviewerNames } from "@/lib/workflow/blinding";
import { diffFieldValues, type FieldChange } from "@/lib/protocols/format";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isCommitteeStaff } from "@/server/authz/staff";
import { ensureWorkingForms, sharedSnapshot } from "@/server/protocols/versions";
import { maxUploadBytes } from "@/server/protocols/settings";
import { suggestedManuscriptName } from "@/lib/protocols/format";
import { formNeedsSignatures, signatureMarks, toRoster } from "@/server/signatures/sign";

const memberInclude = {
  user: true,
  contactEmail: true,
} as const;

export async function canViewProtocol(userId: string, protocolId: string): Promise<boolean> {
  if (await isCommitteeStaff(userId)) return true;
  const member = await prisma.protocolMember.findFirst({
    where: { protocolId, userId, status: { in: ["ACTIVE", "INVITED"] } },
    select: { id: true },
  });
  return Boolean(member);
}

export async function requireView(userId: string, protocolId: string) {
  if (!(await canViewProtocol(userId, protocolId))) {
    throw new AppError("FORBIDDEN", "You cannot open this protocol.", 403);
  }
}

export async function protocolHeader(userId: string, protocolId: string) {
  await requireView(userId, protocolId);
  const protocol = await prisma.protocol.findUnique({
    where: { id: protocolId },
    include: {
      discipline: true,
      panel: true,
      versions: { orderBy: { number: "desc" } },
      members: { where: { userId }, orderBy: { updatedAt: "desc" } },
    },
  });
  if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
  const working = protocol.versions.find((version) => version.state === "WORKING") ?? null;
  const latest = protocol.versions[0] ?? null;
  return {
    protocol,
    working,
    shown: working ?? latest,
    mine: protocol.members[0] ?? null,
    staff: await isCommitteeStaff(userId),
  };
}

export async function listForRole(userId: string, role: "PROPONENT" | "ADVISER") {
  const rows = await prisma.protocolMember.findMany({
    where: { userId, role, status: { not: "REMOVED" } },
    include: {
      protocol: { include: { versions: { orderBy: { number: "desc" }, take: 1 } } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.protocol.id,
    title: row.protocol.title,
    code: row.protocol.code,
    status: row.protocol.status,
    version: row.protocol.versions[0]?.label ?? "—",
    versionState: row.protocol.versions[0]?.state ?? null,
    updatedAt: row.protocol.updatedAt,
    membershipStatus: row.status,
  }));
}

export async function roster(userId: string, protocolId: string) {
  await requireView(userId, protocolId);
  const [members, mine] = await Promise.all([
    prisma.protocolMember.findMany({
      where: { protocolId, status: { not: "REMOVED" } },
      include: memberInclude,
      orderBy: [{ rosterOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.protocolMember.findFirst({ where: { protocolId, userId, status: { not: "REMOVED" } } }),
  ]);
  if (seesReviewerNames(await isCommitteeStaff(userId), members, userId)) return { members, mine };
  return { members: members.filter((member) => member.userId === userId || !isReviewerRole(member.role)), mine };
}

export async function boundValues(protocolId: string) {
  const protocol = await prisma.protocol.findUnique({
    where: { id: protocolId },
    include: { members: { include: memberInclude }, versions: { where: { state: "WORKING" }, take: 1 } },
  });
  if (!protocol) throw new AppError("NOT_FOUND", "That protocol was not found.", 404);
  const label = protocol.versions[0]?.label ?? "";
  const snapshot = sharedSnapshot(protocol, label, protocol.versions[0]?.submittedAt ?? null);
  return {
    "protocol.code": snapshot["protocol.code"],
    "protocol.title": snapshot["protocol.title"],
    "protocol.versionLabel": snapshot["protocol.versionLabel"],
    "protocol.researchers": snapshot["protocol.researchers"],
    "protocol.contactNumbers": snapshot["protocol.contactNumbers"],
    "protocol.emails": snapshot["protocol.emails"],
    "protocol.institution": snapshot["protocol.institution"],
    "protocol.institutionAddress": snapshot["protocol.institutionAddress"],
    "protocol.submissionDate": snapshot["protocol.submissionDate"],
  };
}

export type ListedForm = {
  instanceId: string;
  code: string;
  title: string;
  progress: FormProgress;
};

export async function listWorkingForms(userId: string, protocolId: string): Promise<ListedForm[]> {
  await requireView(userId, protocolId);
  const version = await prisma.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" } });
  if (!version) return [];
  await prisma.$transaction(async (tx) => {
    await ensureWorkingForms(tx, version.id);
  });
  const [instances, memberRows] = await Promise.all([
    prisma.formInstance.findMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id },
      include: { formDefinition: true },
      orderBy: { formDefinition: { code: "asc" } },
    }),
    prisma.protocolMember.findMany({
      where: { protocolId, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { displayName: true } } },
    }),
  ]);
  const marks = await signatureMarks(prisma, instances.map((instance) => instance.id));
  const roster = toRoster(memberRows);
  return instances.flatMap((instance) => {
    const parsed = validateSchema(instance.formDefinition.schema);
    if (!parsed.ok) return [];
    return [
      {
        instanceId: instance.id,
        code: instance.formDefinition.code,
        title: instance.formDefinition.title,
        progress: formProgress(parsed.schema, instance.data, instance.revision, {
          needsSignatures: formNeedsSignatures(parsed.schema, roster, marks.get(instance.id) ?? []),
        }),
      },
    ];
  });
}

export async function formForEdit(userId: string, protocolId: string, instanceId: string) {
  await requireView(userId, protocolId);
  const instance = await prisma.formInstance.findUnique({
    where: { id: instanceId },
    include: { formDefinition: true },
  });
  if (!instance || instance.ownerType !== "PROTOCOL_VERSION") {
    throw new AppError("NOT_FOUND", "That form was not found.", 404);
  }
  const version = await prisma.protocolVersion.findFirst({
    where: { id: instance.ownerId, protocolId },
  });
  if (!version) throw new AppError("NOT_FOUND", "That form was not found.", 404);
  const parsed = validateSchema(instance.formDefinition.schema);
  if (!parsed.ok) throw new AppError("INVALID", "This form schema cannot be shown.", 400);
  const member = await prisma.protocolMember.findFirst({
    where: { protocolId, userId, status: "ACTIVE" },
  });
  const grants = await prisma.userRole.findMany({
    where: { userId, revokedAt: null },
    select: { role: { select: { key: true } } },
  });
  const roles: string[] = [];
  if (member && isRoleKey(member.role)) roles.push(member.role);
  if (member?.isLeader) roles.push("PROJECT_LEADER");
  for (const grant of grants) {
    if (isRoleKey(grant.role.key) && !roles.includes(grant.role.key)) roles.push(grant.role.key);
  }
  const { editingStepFor } = await import("@/server/workflow/access");
  const stepKey = await editingStepFor(prisma, userId, version.id, instance.formDefinition.code);
  let data = instance.data;
  if (instance.status === "DRAFT" && version.state === "WORKING") {
    const { prefillResearcherTable } = await import("@/server/forms/roster-prefill");
    const { applyAssessmentDefaults } = await import("@/lib/forms/defaults");
    const next = await prefillResearcherTable(prisma, {
      instanceId: instance.id,
      protocolId,
      schema: instance.formDefinition.schema,
      data: instance.data,
    });
    const withDefaults = applyAssessmentDefaults(parsed.schema, next, roles, stepKey);
    if (JSON.stringify(withDefaults) !== JSON.stringify(next)) {
      await prisma.formInstance.update({
        where: { id: instance.id },
        data: { data: withDefaults as never },
      });
    }
    data = withDefaults as typeof instance.data;
  }
  return {
    instance: { ...instance, data },
    version,
    schema: parsed.schema,
    roles,
    stepKey,
  };
}

export async function listUploads(userId: string, protocolId: string) {
  const header = await protocolHeader(userId, protocolId);
  const version = header.working ?? header.shown;
  const limit = await maxUploadBytes();
  if (!version) return { header, files: [], suggestedManuscript: null, fee: null, maxBytes: limit };
  const [files, fee] = await Promise.all([
    prisma.storedFile.findMany({ where: { protocolVersionId: version.id }, orderBy: { createdAt: "desc" } }),
    prisma.feeVerification.findUnique({ where: { protocolVersionId: version.id } }),
  ]);
  return {
    header,
    files,
    suggestedManuscript: header.working ? suggestedManuscriptName(header.working.label) : null,
    fee,
    maxBytes: limit,
  };
}

/** Manuscript on the version that owns a form instance, for side-by-side review. */
export async function manuscriptForForm(userId: string, protocolId: string, instanceId: string) {
  await requireView(userId, protocolId);
  const instance = await prisma.formInstance.findFirst({
    where: { id: instanceId, ownerType: "PROTOCOL_VERSION" },
    select: { ownerId: true },
  });
  if (!instance) return null;
  const version = await prisma.protocolVersion.findFirst({
    where: { id: instance.ownerId, protocolId },
    select: { id: true, protocol: { select: { code: true } } },
  });
  if (!version) return null;
  const file = await prisma.storedFile.findFirst({
    where: { protocolVersionId: version.id, kind: "MANUSCRIPT", scanStatus: { not: "INFECTED" } },
    orderBy: { createdAt: "desc" },
  });
  if (!file) return null;
  return {
    fileId: file.id,
    protocolId,
    fileName: file.suggestedName || file.originalName,
    mime: file.mime,
    protocolCode: version.protocol.code,
  };
}

export type VersionDiff = {
  code: string;
  title: string;
  changes: FieldChange[];
};

export async function diffVersions(userId: string, protocolId: string, leftId: string, rightId: string): Promise<VersionDiff[]> {
  await requireView(userId, protocolId);
  const versions = await prisma.protocolVersion.findMany({
    where: { protocolId, id: { in: [leftId, rightId] } },
  });
  if (versions.length !== 2) throw new AppError("NOT_FOUND", "Choose two versions of this protocol.", 404);
  const instances = await prisma.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: { in: [leftId, rightId] } },
    include: { formDefinition: true, revisions: { orderBy: { revision: "desc" }, take: 1 } },
  });
  const codes = new Set(instances.map((instance) => instance.formDefinition.code));
  const rows: VersionDiff[] = [];
  for (const code of [...codes].sort()) {
    const left = instances.find((instance) => instance.ownerId === leftId && instance.formDefinition.code === code);
    const right = instances.find((instance) => instance.ownerId === rightId && instance.formDefinition.code === code);
    const changes = diffFieldValues(left?.data ?? {}, right?.data ?? {});
    rows.push({
      code,
      title: (right ?? left)?.formDefinition.title ?? code,
      changes,
    });
  }
  return rows;
}

export async function listVersions(userId: string, protocolId: string) {
  await requireView(userId, protocolId);
  return prisma.protocolVersion.findMany({
    where: { protocolId },
    orderBy: { number: "asc" },
  });
}

export async function listDisciplines() {
  return prisma.discipline.findMany({
    where: { panel: { active: true } },
    include: { panel: true },
    orderBy: [{ panel: { code: "asc" } }, { name: "asc" }],
  });
}

export async function listPanels() {
  return prisma.panel.findMany({ where: { active: true }, orderBy: { code: "asc" } });
}
