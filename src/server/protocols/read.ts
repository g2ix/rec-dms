import "server-only";
import { validateSchema } from "@/lib/forms/schema";
import { formProgress, type FormProgress } from "@/lib/protocols/format";
import { diffFieldValues, type FieldChange } from "@/lib/protocols/format";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isCommitteeStaff } from "@/server/authz/staff";
import { ensureWorkingForms, sharedSnapshot } from "@/server/protocols/versions";
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
  return { members, mine };
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
  const roles = [];
  if (member?.role === "PROPONENT" || member?.role === "ADVISER") roles.push(member.role);
  if (member?.isLeader) roles.push("PROJECT_LEADER" as const);
  return { instance, version, schema: parsed.schema, roles };
}

export async function listUploads(userId: string, protocolId: string) {
  const header = await protocolHeader(userId, protocolId);
  const version = header.working ?? header.shown;
  if (!version) return { header, files: [], suggestedManuscript: null, fee: null };
  const [files, fee] = await Promise.all([
    prisma.storedFile.findMany({ where: { protocolVersionId: version.id }, orderBy: { createdAt: "desc" } }),
    prisma.feeVerification.findUnique({ where: { protocolVersionId: version.id } }),
  ]);
  return {
    header,
    files,
    suggestedManuscript: header.working ? suggestedManuscriptName(header.working.label) : null,
    fee,
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
