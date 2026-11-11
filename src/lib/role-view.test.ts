import { describe, expect, it } from "vitest";
import { baseViews, viewsForRoleKeys } from "@/lib/role-view";

describe("viewsForRoleKeys", () => {
  it("returns every shell view when the account holds every system role", () => {
    expect(
      viewsForRoleKeys([
        "PROPONENT",
        "PROJECT_LEADER",
        "ADVISER",
        "PRIMARY_REVIEWER",
        "INDEPENDENT_CONSULTANT",
        "REC_MEMBER",
        "PANEL_CHAIR",
        "REC_STAFF",
        "MEMBER_SECRETARY",
        "REC_CHAIR",
        "SYSTEM_ADMIN",
      ]),
    ).toEqual(["proponent", "adviser", "reviewer", "panel-chair", "staff", "chair"]);
  });

  it("ignores unknown keys and keeps switcher order", () => {
    expect(viewsForRoleKeys(["REC_CHAIR", "ADVISER", "NOT_A_ROLE"])).toEqual(["adviser", "chair"]);
  });

  it("returns nothing when the account has no roles", () => {
    expect(viewsForRoleKeys([])).toEqual([]);
  });
});

describe("baseViews", () => {
  it("makes every registrant a proponent", () => {
    expect(baseViews({ emails: ["21101234@usc.edu.ph"], advisesAProtocol: false })).toEqual(["proponent"]);
    expect(baseViews({ emails: ["someone@gmail.com"], advisesAProtocol: false })).toEqual(["proponent"]);
    expect(baseViews({ emails: [], advisesAProtocol: false })).toEqual(["proponent"]);
  });

  it("adds adviser for a firstname.lastname USC address", () => {
    expect(baseViews({ emails: ["Gran.Sabandal@usc.edu.ph"], advisesAProtocol: false })).toEqual(["proponent", "adviser"]);
    expect(baseViews({ emails: ["juan.dela-cruz@usc.edu.ph"], advisesAProtocol: false })).toEqual(["proponent", "adviser"]);
    expect(baseViews({ emails: ["juan.cruz@gmail.com"], advisesAProtocol: false })).toEqual(["proponent"]);
  });

  it("adds adviser for anyone advising a protocol", () => {
    expect(baseViews({ emails: ["outside@gmail.com"], advisesAProtocol: true })).toEqual(["proponent", "adviser"]);
  });
});
