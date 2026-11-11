import { describe, expect, it } from "vitest";
import { matchClientType, parseClientTypeRules, type ClientTypeFacts } from "@/lib/fees/client-type";
import { CLIENT_TYPE_RULES } from "../../../prisma/seed/usc-rec/install-2026-11";

const rules = parseClientTypeRules(CLIENT_TYPE_RULES);
const pick = (facts: ClientTypeFacts) => matchClientType(rules, facts);

describe("client type from the leader's profile", () => {
  it("places every kind of profile the sign-up form offers", () => {
    expect(pick({ profileKind: "USC_STUDENT", academicLevel: "UNDERGRADUATE", programName: "BS Biology" })).toBe("USC_SHS_UNDERGRADUATE");
    expect(pick({ profileKind: "USC_STUDENT", academicLevel: "GRADUATE", programName: "Master of Arts in Education" })).toBe("USC_GRADUATE");
    expect(pick({ profileKind: "USC_STUDENT", academicLevel: "GRADUATE", programName: "Juris Doctor" })).toBe("USC_LAW");
    expect(pick({ profileKind: "USC_STUDENT", academicLevel: "UNDERGRADUATE", course: "Bachelor of Laws" })).toBe("USC_LAW");
    expect(pick({ profileKind: "EXTERNAL_STUDENT", academicLevel: "UNDERGRADUATE", programName: "BS Nursing" })).toBe("EXTERNAL_SHS_UNDERGRADUATE");
    expect(pick({ profileKind: "EXTERNAL_STUDENT", academicLevel: "GRADUATE", programName: "Doctor of Medicine" })).toBe("EXTERNAL_MEDICINE_LAW");
    expect(pick({ profileKind: "EXTERNAL_STUDENT", academicLevel: "GRADUATE", programName: "MS Biology" })).toBe("EXTERNAL_GRADUATE");
    expect(pick({ profileKind: "USC_ACADEMIC", funds: ["RESEARCHER"] })).toBe("USC_FACULTY_WORKLOAD");
    expect(pick({ profileKind: "USC_ACADEMIC", funds: ["AGENCY"] })).toBe("USC_FACULTY_GRANT");
    expect(pick({ profileKind: "USC_STAFF", funds: ["INSTITUTION", "RESEARCHER"] })).toBe("USC_FACULTY_GRANT");
    expect(pick({ profileKind: "USC_STAFF", funds: [] })).toBe("USC_FACULTY_WORKLOAD");
    expect(pick({ profileKind: "EXTERNAL_ADVISER" })).toBe("EXTERNAL_INSTITUTION");
    expect(pick({ profileKind: "INDUSTRY_PARTNER" })).toBe("EXTERNAL_INSTITUTION");
    expect(pick({ profileKind: null })).toBeNull();
  });

  it("does not take a medical technology program for medicine", () => {
    expect(pick({ profileKind: "EXTERNAL_STUDENT", academicLevel: "UNDERGRADUATE", programName: "BS Medical Technology" })).toBe("EXTERNAL_SHS_UNDERGRADUATE");
  });

  it("reads lists, negations and patterns, and skips broken rules", () => {
    const custom = parseClientTypeRules([
      { clientTypeKey: "A", when: { profileKind: { not: ["X", "Y"] }, funds: "GRANT" } },
      { clientTypeKey: "B", when: { programName: { matches: "(" } } },
      { when: {} },
      { clientTypeKey: "C", when: {} },
    ]);
    expect(matchClientType(custom, { profileKind: "Z", funds: ["GRANT"] })).toBe("A");
    expect(matchClientType(custom, { profileKind: "X", funds: ["GRANT"] })).toBe("C");
    expect(custom).toHaveLength(3);
  });
});
