import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { formatDesignation } from "@/lib/affiliation";
import { affiliationSchema } from "@/lib/auth-schemas";
import { AuditAction } from "@/lib/audit-log";
import { formatDisplayName } from "@/lib/display-name";
import type { NameParts } from "@/lib/name-parts";
import {
  isProfileKind,
  profileDraftFromForm,
  toMembershipAffiliation,
  USC_INSTITUTION_NAME,
  type MembershipAffiliation,
  type OrgCatalog,
  type PersonProfileView,
  type ProfileDraft,
} from "@/lib/profile";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

type Writer = Prisma.TransactionClient | typeof prisma;

const profileInclude = {
  institution: true,
  school: true,
  department: true,
  office: true,
  program: true,
} as const;

function empty(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  return text || null;
}

export async function orgCatalog(): Promise<OrgCatalog> {
  const [institutions, units] = await Promise.all([
    prisma.institution.findMany({ orderBy: { name: "asc" } }),
    prisma.orgUnit.findMany({ orderBy: { name: "asc" } }),
  ]);
  return {
    uscInstitutionId: institutions.find((row) => row.name === USC_INSTITUTION_NAME)?.id ?? null,
    institutions: institutions.map((row) => ({ id: row.id, name: row.name })),
    units: units.map((row) => ({
      id: row.id,
      institutionId: row.institutionId,
      parentId: row.parentId,
      kind: row.kind,
      name: row.name,
      academicLevel: row.academicLevel,
    })),
  };
}

export async function getPersonProfile(userId: string): Promise<PersonProfileView | null> {
  const row = await prisma.personProfile.findUnique({ where: { userId }, include: profileInclude });
  if (!row || !isProfileKind(row.kind)) return null;
  return {
    kind: row.kind,
    academicLevel: row.academicLevel ?? "",
    institutionId: row.institutionId ?? "",
    institutionName: row.institution?.name || row.institutionText,
    schoolId: row.schoolId ?? "",
    departmentId: row.departmentId ?? "",
    officeId: row.officeId ?? "",
    programId: row.programId ?? "",
    institutionText: row.institution?.name || row.institutionText,
    unitText: row.unitText,
    programText: row.program?.name || row.programText,
    yearLabel: row.yearLabel ?? "",
    position: row.position ?? "",
  };
}

async function resolveDraft(draft: ProfileDraft, db: Writer) {
  const ids = [draft.schoolId, draft.departmentId, draft.officeId, draft.programId].filter((id): id is string => Boolean(id));
  const units = ids.length ? await db.orgUnit.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const school = draft.schoolId ? byId.get(draft.schoolId) : undefined;
  const department = draft.departmentId ? byId.get(draft.departmentId) : undefined;
  const office = draft.officeId ? byId.get(draft.officeId) : undefined;
  const program = draft.programId ? byId.get(draft.programId) : undefined;
  if (draft.schoolId && (!school || school.kind !== "SCHOOL")) {
    throw new AppError("INVALID", "Choose a school from the list.", 400);
  }
  if (draft.departmentId && (!department || department.kind !== "DEPARTMENT")) {
    throw new AppError("INVALID", "Choose a department from the list.", 400);
  }
  if (draft.officeId && (!office || office.kind !== "OFFICE")) {
    throw new AppError("INVALID", "Choose an office from the list.", 400);
  }
  if (draft.programId && (!program || program.kind !== "PROGRAM")) {
    throw new AppError("INVALID", "Choose a program from the list.", 400);
  }
  if (school && department && department.parentId !== school.id) {
    throw new AppError("INVALID", "That department is not in the chosen school.", 400);
  }
  if (school && office?.parentId && office.parentId !== school.id && office.parentId !== department?.id) {
    throw new AppError("INVALID", "That office is not in the chosen school.", 400);
  }
  if (department && program && program.parentId !== department.id) {
    throw new AppError("INVALID", "That program is not in the chosen department.", 400);
  }

  const uscKind = draft.kind === "USC_STUDENT" || draft.kind === "USC_ACADEMIC" || draft.kind === "USC_STAFF";
  let institutionId = empty(draft.institutionId);
  let institutionName = draft.institutionText?.trim() ?? "";
  if (uscKind) {
    const usc = await db.institution.findUnique({ where: { name: USC_INSTITUTION_NAME } });
    if (!usc) throw new AppError("NOT_FOUND", "The USC organization list is not loaded yet.", 400);
    institutionId = usc.id;
    institutionName = usc.name;
  } else if (institutionId) {
    const row = await db.institution.findUnique({ where: { id: institutionId } });
    if (!row) throw new AppError("INVALID", "Choose an institution from the list.", 400);
    institutionName = row.name;
  }
  if (!institutionName) throw new AppError("INVALID", "Enter the institution.", 400);

  const academicLevel =
    draft.academicLevel === "UNDERGRADUATE" || draft.academicLevel === "GRADUATE" ? draft.academicLevel : null;
  const programName = program?.name || draft.programText?.trim() || null;
  return {
    data: {
      kind: draft.kind,
      institutionId,
      schoolId: school?.id ?? null,
      departmentId: department?.id ?? null,
      officeId: office?.id ?? null,
      programId: program?.id ?? null,
      institutionText: institutionName,
      unitText: draft.unitText?.trim() ?? "",
      programText: programName ?? "",
      academicLevel,
      yearLabel: draft.yearLabel?.trim() || null,
      position: draft.position?.trim() || null,
    },
    names: {
      institution: institutionName,
      schoolName: school?.name ?? null,
      departmentName: department?.name ?? null,
      officeName: office?.name ?? null,
      programName,
      unitText: draft.unitText?.trim() || null,
      yearLabel: draft.yearLabel?.trim() || null,
      position: draft.position?.trim() || null,
      academicLevel,
    },
  };
}

export async function savePersonProfile(
  userId: string,
  draft: ProfileDraft,
  name?: (NameParts & { firstName: string; familyName: string }) | null,
) {
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const resolved = await resolveDraft(draft, tx);
    const before = await tx.personProfile.findUnique({ where: { userId } });
    const profile = await tx.personProfile.upsert({
      where: { userId },
      create: { userId, ...resolved.data },
      update: resolved.data,
    });
    if (name) {
      const displayName = formatDisplayName(name.firstName, name.middleName, name.familyName);
      await tx.user.update({
        where: { id: userId },
        data: {
          firstName: name.firstName.trim(),
          familyName: name.familyName.trim(),
          title: name.title,
          middleName: name.middleName,
          middleInitial: name.middleInitial,
          suffix: name.suffix,
          credentials: name.credentials,
          displayName,
          name: displayName,
        },
      });
    }
    await audit.record(tx, {
      actorUserId: userId,
      action: AuditAction.profileSaved,
      entityType: "person_profile",
      entityId: profile.id,
      diff: diffOf({ kind: before?.kind ?? null }, { kind: profile.kind, institution: resolved.data.institutionText }),
      meta,
    });
    return profile;
  });
}

export async function affiliationFromForm(formData: FormData) {
  const postedKind = String(formData.get("profileKind") ?? "");
  if (isProfileKind(postedKind)) {
    const resolved = await membershipFromForm(formData);
    return { draft: resolved.draft, affiliation: resolved.affiliation };
  }
  const kind = formData.get("kind") === "FACULTY" ? "FACULTY" : "STUDENT";
  const affiliation = affiliationSchema.parse({
    kind,
    course: formData.get("course"),
    yearLabel: formData.get("yearLabel"),
    position: formData.get("position"),
    unit: formData.get("unit"),
    institution: formData.get("institution"),
    contactEmailId: formData.get("contactEmailId"),
  });
  return {
    draft: null,
    affiliation: {
      ...affiliation,
      designationText: formatDesignation(affiliation),
      profileKind: null,
      academicLevel: null,
      schoolName: null,
      departmentName: null,
      officeName: null,
      programName: null,
    },
  };
}

export async function membershipFromForm(formData: FormData): Promise<{
  draft: ProfileDraft;
  affiliation: MembershipAffiliation;
}> {
  const draft = profileDraftFromForm(formData);
  const contactEmailId = z.string().uuid("Choose a contact email.").parse(formData.get("contactEmailId"));
  const resolved = await resolveDraft(draft, prisma);
  const override = String(formData.get("institution") ?? "").trim();
  return {
    draft,
    affiliation: toMembershipAffiliation({
      contactEmailId,
      kind: draft.kind,
      ...resolved.names,
      institution: override || resolved.names.institution,
    }),
  };
}
