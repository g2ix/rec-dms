import { describe, expect, it } from "vitest";
import { viewsForRoleKeys } from "@/lib/role-view";

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
