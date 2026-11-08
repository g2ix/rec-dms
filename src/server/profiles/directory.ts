import "server-only";
import type { AcademicLevel, Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { normalizeEmail } from "@/lib/email";
import { isProfileKind, type AcademicLevelValue, type ProfileKind } from "@/lib/profile";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";

type Writer = Prisma.TransactionClient | typeof prisma;

export type DirectoryRow = {
  email: string;
  studentNumber?: string | null;
  kind: ProfileKind;
  schoolCode?: string | null;
  departmentCode?: string | null;
  officeCode?: string | null;
  programCode?: string | null;
  institutionText?: string | null;
  unitText?: string | null;
  programText?: string | null;
  academicLevel?: AcademicLevelValue | null;
  yearLabel?: string | null;
  position?: string | null;
};

function profileColumns(entry: {
  kind: string;
  institutionId: string | null;
  schoolId: string | null;
  departmentId: string | null;
  officeId: string | null;
  programId: string | null;
  institutionText: string;
  unitText: string;
  programText: string;
  academicLevel: AcademicLevel | null;
  yearLabel: string | null;
  position: string | null;
}) {
  return {
    kind: entry.kind,
    institutionId: entry.institutionId,
    schoolId: entry.schoolId,
    departmentId: entry.departmentId,
    officeId: entry.officeId,
    programId: entry.programId,
    institutionText: entry.institutionText,
    unitText: entry.unitText,
    programText: entry.programText,
    academicLevel: entry.academicLevel,
    yearLabel: entry.yearLabel,
    position: entry.position,
  };
}

async function writeClaim(userId: string, email: string, db: Prisma.TransactionClient) {
  const entry = await db.directoryEntry.findUnique({ where: { email: normalizeEmail(email) } });
  if (!entry || entry.linkedUserId) return null;
  const existing = await db.personProfile.findUnique({ where: { userId } });
  if (!existing) {
    const profile = await db.personProfile.create({
      data: { userId, ...profileColumns(entry) },
    });
    await audit.record(db, {
      actorUserId: userId,
      action: AuditAction.profileSaved,
      entityType: "person_profile",
      entityId: profile.id,
      diff: diffOf({}, { kind: entry.kind, source: "directory", email: entry.email }),
      meta: await auditRequestMeta({}),
    });
  }
  await db.directoryEntry.update({ where: { id: entry.id }, data: { linkedUserId: userId } });
  return entry;
}

/** Attach a matching directory row to a new account. Does not replace a profile the person already saved. */
export async function claimDirectoryEntry(userId: string, email: string, db: Writer = prisma) {
  if (db === prisma) return prisma.$transaction((tx) => writeClaim(userId, email, tx));
  return writeClaim(userId, email, db);
}

async function unitId(db: Writer, code: string | null | undefined, label: string) {
  const trimmed = code?.trim();
  if (!trimmed) return null;
  const unit = await db.orgUnit.findUnique({ where: { code: trimmed } });
  if (!unit) throw new AppError("NOT_FOUND", `The ${label} “${trimmed}” is not in the organization list.`, 400);
  return unit.id;
}

/** Load registrar or HR rows. A verified account with the same email is linked when it has no profile yet. */
export async function importDirectory(rows: DirectoryRow[], db: Writer = prisma) {
  const linked: string[] = [];
  for (const row of rows) {
    if (!isProfileKind(row.kind)) throw new AppError("INVALID", "That affiliation kind is not recognized.", 400);
    const email = normalizeEmail(row.email);
    const schoolId = await unitId(db, row.schoolCode, "school");
    const departmentId = await unitId(db, row.departmentCode, "department");
    const officeId = await unitId(db, row.officeCode, "office");
    const programId = await unitId(db, row.programCode, "program");
    const school = schoolId ? await db.orgUnit.findUnique({ where: { id: schoolId } }) : null;
    const data = {
      email,
      studentNumber: row.studentNumber?.trim() || null,
      kind: row.kind,
      institutionId: school?.institutionId ?? null,
      schoolId,
      departmentId,
      officeId,
      programId,
      institutionText: row.institutionText?.trim() ?? "",
      unitText: row.unitText?.trim() ?? "",
      programText: row.programText?.trim() ?? "",
      academicLevel: row.academicLevel ?? null,
      yearLabel: row.yearLabel?.trim() || null,
      position: row.position?.trim() || null,
    };
    await db.directoryEntry.upsert({
      where: { email },
      create: data,
      update: data,
    });
    const account = await db.userEmail.findUnique({ where: { email } });
    if (account) {
      const claimed = await claimDirectoryEntry(account.userId, email, db);
      if (claimed) linked.push(email);
    }
  }
  return { imported: rows.length, linked };
}
