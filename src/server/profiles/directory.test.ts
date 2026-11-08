import { describe, expect, it } from "vitest";
import { installUscOrg } from "@/lib/org/usc-seed";
import { prisma } from "@/server/db";
import { importDirectory } from "@/server/profiles/directory";
import { savePersonProfile } from "@/server/profiles/profile";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { makeUser } from "@/server/test/users";
import { toMembershipAffiliation } from "@/lib/profile";

describe("directory and profile", () => {
  it("links a directory row when the account is created and copies it onto a protocol", async () => {
    await installUscOrg(prisma);
    const stamp = Date.now().toString();
    const email = `${stamp}@usc.edu.ph`;
    await importDirectory([
      {
        email,
        studentNumber: stamp,
        kind: "USC_STUDENT",
        schoolCode: "usc.sas",
        departmentCode: "usc.sas.biology",
        academicLevel: "UNDERGRADUATE",
        yearLabel: "2nd year",
        programText: "BS Biology",
      },
    ]);
    const user = await makeUser({ email, firstName: "Ana", familyName: "Reyes", middleInitial: "B" });
    const profile = await prisma.personProfile.findUnique({
      where: { userId: user.id },
      include: { department: true, school: true },
    });
    expect(profile?.kind).toBe("USC_STUDENT");
    expect(profile?.yearLabel).toBe("2nd year");
    expect(profile?.programText).toBe("BS Biology");
    expect(profile?.department?.code).toBe("usc.sas.biology");
    expect(profile?.school?.code).toBe("usc.sas");
    const entry = await prisma.directoryEntry.findUnique({ where: { email } });
    expect(entry?.linkedUserId).toBe(user.id);

    const created = await createProtocolForUser(user.id, {
      title: "Directory study",
      affiliation: toMembershipAffiliation({
        contactEmailId: user.emails[0]!.id,
        kind: "USC_STUDENT",
        institution: "University of San Carlos",
        programName: profile?.programText,
        yearLabel: profile?.yearLabel,
        departmentName: profile?.department?.name,
        schoolName: profile?.school?.name,
        academicLevel: "UNDERGRADUATE",
      }),
    });
    expect(created.member.profileKind).toBe("USC_STUDENT");
    expect(created.member.affiliationKind).toBe("STUDENT");
    expect(created.member.designation).toBe(
      "BS Biology, 2nd year, Biology, School of Arts and Sciences, University of San Carlos",
    );
    expect(created.member.schoolName).toBe("School of Arts and Sciences");
  });

  it("does not replace a profile that was already saved", async () => {
    await installUscOrg(prisma);
    const email = `kept.${Date.now()}@usc.edu.ph`;
    const user = await makeUser({ email, firstName: "Liza", familyName: "Santos", middleInitial: null });
    const school = await prisma.orgUnit.findUniqueOrThrow({ where: { code: "usc.sas" } });
    const department = await prisma.orgUnit.findUniqueOrThrow({ where: { code: "usc.sas.physics" } });
    await savePersonProfile(user.id, {
      kind: "USC_STUDENT",
      academicLevel: "GRADUATE",
      institutionId: "",
      schoolId: school.id,
      departmentId: department.id,
      officeId: "",
      programId: "",
      institutionText: "",
      unitText: "",
      programText: "MS Physics",
      yearLabel: "1st year",
      position: "",
    });
    await importDirectory([
      {
        email,
        kind: "USC_STUDENT",
        schoolCode: "usc.sas",
        departmentCode: "usc.sas.biology",
        academicLevel: "UNDERGRADUATE",
        yearLabel: "4th year",
        programText: "BS Biology",
      },
    ]);
    const profile = await prisma.personProfile.findUnique({ where: { userId: user.id } });
    expect(profile?.programText).toBe("MS Physics");
    expect(profile?.departmentId).toBe(department.id);
  });
});
