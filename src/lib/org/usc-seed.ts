import type { PrismaClient } from "@prisma/client";
import { USC_INSTITUTION_NAME } from "@/lib/profile";

const SCHOOLS = [
  { code: "usc.engineering", name: "School of Engineering" },
  { code: "usc.sas", name: "School of Arts and Sciences" },
  { code: "usc.architecture", name: "School of Architecture" },
  { code: "usc.safad", name: "School of Fine Arts and Design" },
  { code: "usc.law", name: "School of Law and Governance" },
] as const;

const SAS_DEPARTMENTS = [
  { code: "usc.sas.dcll", name: "DCLL" },
  { code: "usc.sas.dcism", name: "DCISM" },
  { code: "usc.sas.biology", name: "Biology" },
  { code: "usc.sas.physics", name: "Physics" },
] as const;

/** Schools named for this slice, plus the four Arts and Sciences departments that were named. */
export async function installUscOrg(db: PrismaClient) {
  const institution = await db.institution.upsert({
    where: { name: USC_INSTITUTION_NAME },
    create: { name: USC_INSTITUTION_NAME, category: "UNIVERSITY" },
    update: { category: "UNIVERSITY" },
  });
  let sasId: string | null = null;
  for (const school of SCHOOLS) {
    const row = await db.orgUnit.upsert({
      where: { code: school.code },
      create: {
        code: school.code,
        name: school.name,
        kind: "SCHOOL",
        institutionId: institution.id,
      },
      update: { name: school.name, kind: "SCHOOL", institutionId: institution.id, parentId: null },
    });
    if (school.code === "usc.sas") sasId = row.id;
  }
  if (!sasId) return institution;
  for (const department of SAS_DEPARTMENTS) {
    await db.orgUnit.upsert({
      where: { code: department.code },
      create: {
        code: department.code,
        name: department.name,
        kind: "DEPARTMENT",
        institutionId: institution.id,
        parentId: sasId,
      },
      update: {
        name: department.name,
        kind: "DEPARTMENT",
        institutionId: institution.id,
        parentId: sasId,
      },
    });
  }
  return institution;
}
