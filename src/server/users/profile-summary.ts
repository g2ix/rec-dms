import "server-only";
import { PROFILE_KIND_LABELS, type PersonProfileView } from "@/lib/profile";
import { prisma } from "@/server/db";

export type ProfileRow = { label: string; value: string };

/** The profile as REC Staff read it before approving: labelled rows, blanks left out. */
export async function profileRows(profiles: (PersonProfileView | null)[]): Promise<ProfileRow[][]> {
  const ids = profiles.flatMap((profile) => (profile ? [profile.schoolId, profile.departmentId, profile.officeId] : [])).filter(Boolean);
  const units = ids.length ? await prisma.orgUnit.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const unitName = new Map(units.map((unit) => [unit.id, unit.name]));
  return profiles.map((profile) => {
    if (!profile) return [];
    const level = profile.academicLevel === "GRADUATE" ? "Graduate" : profile.academicLevel === "UNDERGRADUATE" ? "Undergraduate" : "";
    const rows: ProfileRow[] = [
      { label: "Type", value: PROFILE_KIND_LABELS[profile.kind] },
      { label: "Institution", value: profile.institutionName },
      { label: "School", value: unitName.get(profile.schoolId) ?? "" },
      { label: "Department", value: unitName.get(profile.departmentId) ?? profile.unitText },
      { label: "Office", value: unitName.get(profile.officeId) ?? "" },
      { label: "Program", value: profile.programText },
      { label: "Level", value: [level, profile.yearLabel].filter(Boolean).join(", ") },
      { label: "Position", value: profile.position },
    ];
    return rows.filter((row) => row.value.trim() !== "");
  });
}
