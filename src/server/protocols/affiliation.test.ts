import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createProtocolForUser, joinProtocol, membershipPrint, suggestAffiliation } from "@/server/protocols/affiliation";
import { ensureVerifiedEmail } from "@/server/auth/users";
import { makeUser } from "@/server/test/users";

describe("per-protocol affiliation", () => {
  it("stores a different designation and contact email on each protocol and prints both", async () => {
    const user = await makeUser({
      email: "juan.cruz@usc.edu.ph",
      firstName: "Juan",
      familyName: "Cruz",
    });
    const personal = await ensureVerifiedEmail(user.id, "juan.cruz@gmail.com");
    const student = await createProtocolForUser(user.id, {
      title: "Classroom study",
      affiliation: {
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "3rd year",
        institution: "University of San Carlos",
        contactEmailId: user.emails[0]!.id,
      },
    });
    const suggestions = await suggestAffiliation(user.id);
    expect(suggestions.student).toMatchObject({ course: "BS Biology", yearLabel: "3rd year" });

    const facultyProtocol = await prisma.protocol.create({
      data: { title: "Graduate advising", createdById: user.id },
    });
    const faculty = await joinProtocol({
      userId: user.id,
      protocolId: facultyProtocol.id,
      role: "ADVISER",
      affiliation: {
        kind: "FACULTY",
        position: "Associate Professor",
        unit: "Department of Biology",
        institution: "University of San Carlos",
        contactEmailId: personal.id,
      },
    });

    const studentPrint = await membershipPrint(student.member.id);
    const facultyPrint = await membershipPrint(faculty.id);
    expect(studentPrint).toEqual({
      name: "Juan D. Cruz",
      designation: "BS Biology, 3rd year, University of San Carlos",
      email: "juan.cruz@usc.edu.ph",
      institution: "University of San Carlos",
      kind: "STUDENT",
    });
    expect(facultyPrint).toEqual({
      name: "Juan D. Cruz",
      designation: "Associate Professor, Department of Biology, University of San Carlos",
      email: "juan.cruz@gmail.com",
      institution: "University of San Carlos",
      kind: "FACULTY",
    });
    expect(student.member.designation).toBe(studentPrint.designation);
    expect(faculty.designation).toBe(facultyPrint.designation);
  });
});
