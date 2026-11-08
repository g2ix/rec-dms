import { describe, expect, it } from "vitest";
import type { ProfileDraft } from "@/lib/profile";
import {
  requiredLeftLabel,
  sectionIdFromHash,
  sectionProgress,
  type SectionKey,
  type SectionProgressInput,
} from "./sections";

const DISCIPLINE = "11111111-1111-4111-8111-111111111111";
const EMAIL = "22222222-2222-4222-8222-222222222222";
const SCHOOL = "33333333-3333-4333-8333-333333333333";
const DEPARTMENT = "44444444-4444-4444-8444-444444444444";

function faculty(partial: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    kind: "USC_ACADEMIC",
    academicLevel: "",
    institutionId: "",
    schoolId: "",
    departmentId: "",
    officeId: "",
    programId: "",
    institutionText: "",
    unitText: "",
    programText: "",
    yearLabel: "",
    position: "",
    ...partial,
  };
}

function input(partial: Partial<SectionProgressInput> = {}): SectionProgressInput {
  return {
    title: "",
    disciplineId: "",
    researchTypeCodes: [],
    researchTypeOther: "",
    funding: [],
    institution: "",
    contactEmailId: "",
    affiliation: faculty(),
    touched: {},
    ...partial,
  };
}

function section(partial: Partial<SectionProgressInput>, key: SectionKey) {
  return sectionProgress(input(partial)).find((item) => item.key === key);
}

describe("new protocol section progress", () => {
  it("counts title, discipline, and research type as the study's three requirements", () => {
    const study = section({ disciplineId: DISCIPLINE }, "study");
    expect(study?.status).toBe("in-progress");
    expect(study?.gaps).toEqual(["title", "researchTypes"]);
    expect(study?.missing).toBe(2);
  });

  it("keeps an untouched empty study at not-started", () => {
    const study = section({}, "study");
    expect(study?.status).toBe("not-started");
    expect(study?.missing).toBe(3);
  });

  it("treats Others without a specification as the one unmet research-type requirement", () => {
    const study = section(
      { title: "Sleep study", disciplineId: DISCIPLINE, researchTypeCodes: ["OTHER"], researchTypeOther: "" },
      "study",
    );
    expect(study?.gaps).toEqual(["researchTypes"]);
    expect(study?.focusKey).toBe("researchTypeOther");
    expect(study?.status).toBe("in-progress");
  });

  it("marks the study complete once the three requirements pass", () => {
    const study = section(
      { title: "Sleep study", disciplineId: DISCIPLINE, researchTypeCodes: ["OTHER"], researchTypeOther: "Survey" },
      "study",
    );
    expect(study?.status).toBe("complete");
    expect(study?.gaps).toEqual([]);
  });

  it("leaves where optional because its fields are not required", () => {
    const where = section({ institution: "" }, "where");
    expect(where?.status).toBe("optional");
    expect(where?.missing).toBe(0);
  });

  it("adds a funding follow-up only for a checked source that needs one", () => {
    const quiet = section({ contactEmailId: EMAIL, funding: [{ code: "RESEARCHER", detail: "" }] }, "contact");
    expect(quiet?.status).toBe("complete");
    expect(quiet?.gaps).toEqual([]);

    const named = section(
      {
        contactEmailId: EMAIL,
        funding: [
          { code: "INSTITUTION", detail: "University of San Carlos" },
          { code: "AGENCY", detail: "" },
        ],
      },
      "contact",
    );
    expect(named?.gaps).toEqual(["fundingDetail_AGENCY"]);
    expect(named?.focusKey).toBe("fundingDetail_AGENCY");
    expect(named?.missing).toBe(1);
  });

  it("reads affiliation gaps from the profile schema and counts institution with that card", () => {
    const incomplete = section({ institution: "University of San Carlos" }, "affiliation");
    expect(incomplete?.gaps).toEqual(["position", "schoolId", "departmentId"]);

    const student = section(
      {
        institution: "",
        affiliation: faculty({
          kind: "USC_STUDENT",
          academicLevel: "",
          yearLabel: "",
          programText: "",
          schoolId: "",
          departmentId: "",
          position: "",
        }),
      },
      "affiliation",
    );
    expect(student?.gaps).toEqual(["institution", "academicLevel", "schoolId", "departmentId", "programText", "yearLabel"]);
    expect(student?.gaps).not.toContain("position");
  });

  it("marks affiliation complete when the schema and the institution pass", () => {
    const done = section(
      {
        institution: "University of San Carlos",
        affiliation: faculty({ schoolId: SCHOOL, departmentId: DEPARTMENT, position: "Professor" }),
      },
      "affiliation",
    );
    expect(done?.status).toBe("complete");
    expect(done?.missing).toBe(0);
  });

  it("points a department-other gap at the unit text", () => {
    const affiliation = section(
      {
        institution: "University of San Carlos",
        affiliation: faculty({ schoolId: SCHOOL, departmentId: "", position: "Professor" }),
        affiliationFocus: { departmentId: "unitText" },
      },
      "affiliation",
    );
    expect(affiliation?.gaps).toEqual(["departmentId"]);
    expect(affiliation?.focusKey).toBe("unitText");
  });

  it("sums the footer and pluralizes it", () => {
    const sections = sectionProgress(input({ disciplineId: DISCIPLINE, contactEmailId: EMAIL, institution: "USC" }));
    const missing = sections.reduce((sum, item) => sum + item.missing, 0);
    expect(requiredLeftLabel(missing)).toBe(`${missing} required fields left`);
    expect(requiredLeftLabel(1)).toBe("1 required field left");
    expect(requiredLeftLabel(0)).toBe("Ready to create");
  });

  it("maps a hash to a section and ignores an unknown one", () => {
    expect(sectionIdFromHash("#funding")).toBe("protocol-funding");
    expect(sectionIdFromHash("protocol-study-heading")).toBe("protocol-study");
    expect(sectionIdFromHash("#nope")).toBeNull();
    expect(sectionIdFromHash("")).toBeNull();
  });
});
