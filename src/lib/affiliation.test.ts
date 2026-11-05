import { describe, expect, it } from "vitest";
import { bindMembershipPrint, formatDesignation } from "@/lib/affiliation";

describe("protocol designation", () => {
  it("prints a different designation and email for each protocol", () => {
    const student = bindMembershipPrint({
      name: "Juan D. Cruz",
      email: "juan.cruz@usc.edu.ph",
      affiliation: {
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "3rd year",
        institution: "University of San Carlos",
      },
    });
    const faculty = bindMembershipPrint({
      name: "Juan D. Cruz",
      email: "jdcruz@gmail.com",
      affiliation: {
        kind: "FACULTY",
        position: "Associate Professor",
        unit: "Department of Biology",
        institution: "University of San Carlos",
      },
    });

    expect(student.designation).toBe(formatDesignation({
      kind: "STUDENT",
      course: "BS Biology",
      yearLabel: "3rd year",
      institution: "University of San Carlos",
    }));
    expect(student.designation).toBe("BS Biology, 3rd year, University of San Carlos");
    expect(faculty.designation).toBe("Associate Professor, Department of Biology, University of San Carlos");
    expect(student.email).not.toBe(faculty.email);
    expect(student.designation).not.toBe(faculty.designation);
  });
});
