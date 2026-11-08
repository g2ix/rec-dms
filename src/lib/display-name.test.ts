import { describe, expect, it } from "vitest";
import { formatDisplayName, formatFormalName, formatRecFormAffiliation, formatRecFormName } from "@/lib/display-name";
import { parseCredentials, resolveMiddle } from "@/lib/name-parts";
import { formatProfileDesignation, suggestProfileKind } from "@/lib/profile";

describe("formal name", () => {
  it("keeps the short name free of title and degrees", () => {
    expect(formatDisplayName("Juan", "D", "Cruz")).toBe("Juan D. Cruz");
  });

  it("prints title, suffix, and credentials after the short name", () => {
    expect(
      formatFormalName({
        title: "Engr.",
        firstName: "Juan",
        middleName: "Dela Cruz",
        familyName: "Cruz",
        suffix: "Jr",
        credentials: ["PhD", "MSIT"],
      }),
    ).toBe("Engr. Juan D. Cruz Jr., PhD, MSIT");
  });

  it("takes the printed letter from the middle name", () => {
    expect(formatDisplayName("Juan", "Santos", "Cruz")).toBe("Juan S. Cruz");
    expect(
      formatFormalName({
        firstName: "Juan",
        middleName: "Santos",
        middleInitial: "X",
        familyName: "Cruz",
      }),
    ).toBe("Juan S. Cruz");
    expect(resolveMiddle("Santos", "X")).toEqual({ middleName: "Santos", middleInitial: "S" });
    expect(resolveMiddle(null, "D")).toEqual({ middleName: "D", middleInitial: "D" });
    expect(parseCredentials("phd, MSIT, phd")).toEqual(["PhD", "MSIT"]);
  });

  it("builds the REC form preview from the fields the person is typing", () => {
    expect(
      formatRecFormName({
        title: "Engr.",
        firstName: "Juan",
        middleName: "Dela Cruz",
        familyName: "Cruz",
        suffix: "Jr",
        credentials: "PhD, MSIT",
      }),
    ).toBe("Engr. Juan D. Cruz Jr., PhD, MSIT");
    expect(formatRecFormName({ title: "other", titleOther: "Hon.", firstName: "Ana", familyName: "Reyes" })).toBe(
      "Hon. Ana Reyes",
    );
    expect(formatRecFormName({ firstName: "Gran", familyName: "Sabandal" })).toBe("Gran Sabandal");
    expect(
      formatRecFormAffiliation({ department: "Biology", school: "", institution: "University of San Carlos" }),
    ).toBe("Biology, University of San Carlos");
  });
});

describe("profile kind hint", () => {
  it("uses the USC local part only as a suggestion", () => {
    expect(suggestProfileKind("21101234@usc.edu.ph")).toBe("USC_STUDENT");
    expect(suggestProfileKind("juan.cruz@usc.edu.ph")).toBe("USC_ACADEMIC");
    expect(suggestProfileKind("juan@usc.edu.ph")).toBeNull();
    expect(suggestProfileKind("ana.reyes@gmail.com")).toBeNull();
  });
});

describe("profile designation", () => {
  it("prints the program, year, department, and school for a USC student", () => {
    expect(
      formatProfileDesignation({
        kind: "USC_STUDENT",
        programName: "BS Biology",
        yearLabel: "3rd year",
        departmentName: "Biology",
        schoolName: "School of Arts and Sciences",
        institution: "University of San Carlos",
      }),
    ).toBe("BS Biology, 3rd year, Biology, School of Arts and Sciences, University of San Carlos");
  });

  it("keeps a legacy student line when the extra parts are empty", () => {
    expect(
      formatProfileDesignation({
        kind: "STUDENT",
        course: "BS Biology",
        yearLabel: "3rd year",
        institution: "University of San Carlos",
      }),
    ).toBe("BS Biology, 3rd year, University of San Carlos");
  });
});
