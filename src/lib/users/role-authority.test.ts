import { describe, expect, it } from "vitest";
import { canGrantRole, isAccountRole } from "@/lib/users/role-authority";

const facts = (keys: string[], admin = false) => ({ roleKeys: new Set(keys), actsAsSystemAdmin: admin });

describe("canGrantRole", () => {
  it("lets REC Staff set account roles only", () => {
    expect(canGrantRole(facts(["REC_STAFF"]), "PROPONENT")).toBe(true);
    expect(canGrantRole(facts(["REC_STAFF"]), "ADVISER")).toBe(true);
    expect(canGrantRole(facts(["REC_STAFF"]), "PANEL_CHAIR")).toBe(false);
    expect(canGrantRole(facts(["REC_STAFF"]), "PRIMARY_REVIEWER")).toBe(false);
  });

  it("lets the REC Chair appoint the committee but not System Admin", () => {
    expect(canGrantRole(facts(["REC_CHAIR"]), "PANEL_CHAIR")).toBe(true);
    expect(canGrantRole(facts(["REC_CHAIR"]), "ADVISER")).toBe(true);
    expect(canGrantRole(facts(["REC_CHAIR"]), "SYSTEM_ADMIN")).toBe(false);
  });

  it("lets a System Admin grant anything known, and nobody grants an unknown role", () => {
    expect(canGrantRole(facts([], true), "SYSTEM_ADMIN")).toBe(true);
    expect(canGrantRole(facts([], true), "PROJECT_LEADER")).toBe(false);
    expect(isAccountRole("PROJECT_LEADER")).toBe(false);
  });
});
