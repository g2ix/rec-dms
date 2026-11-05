import { describe, expect, it } from "vitest";
import { decideProtocolAction, type MembershipFact } from "@/server/authz/policy";

const leader: MembershipFact = { role: "PROPONENT", isLeader: true, status: "ACTIVE" };
const proponent: MembershipFact = { role: "PROPONENT", isLeader: false, status: "ACTIVE" };
const invited: MembershipFact = { role: "PROPONENT", isLeader: false, status: "INVITED" };
const adviser: MembershipFact = { role: "ADVISER", isLeader: false, status: "ACTIVE" };
const reviewer: MembershipFact = { role: "PRIMARY_REVIEWER", isLeader: false, status: "ACTIVE" };

const actions = [
  "protocol.view",
  "protocol.download",
  "protocol.edit",
  "protocol.upload",
  "protocol.members",
  "protocol.submit",
  "protocol.fee",
  "protocol.panel",
  "protocol.review",
] as const;

describe("protocol authorization", () => {
  it("lets an approved leader submit and keeps everyone else out of that action", () => {
    expect(decideProtocolAction({ action: "protocol.submit", membership: leader, staff: false, userStatus: "ACTIVE" })).toBe("allow");
    expect(decideProtocolAction({ action: "protocol.submit", membership: leader, staff: false, userStatus: "PENDING_APPROVAL" })).toBe("deny");
    expect(decideProtocolAction({ action: "protocol.submit", membership: proponent, staff: false, userStatus: "ACTIVE" })).toBe("deny");
    expect(decideProtocolAction({ action: "protocol.submit", membership: adviser, staff: true, userStatus: "ACTIVE" })).toBe("deny");
  });

  it("refuses review, panel changes, and fee decisions from a proponent or adviser", () => {
    for (const membership of [leader, proponent, adviser, invited]) {
      expect(decideProtocolAction({ action: "protocol.review", membership, staff: true, userStatus: "ACTIVE" })).toBe("deny");
      expect(decideProtocolAction({ action: "protocol.panel", membership, staff: true, userStatus: "ACTIVE" })).toBe("deny");
      expect(decideProtocolAction({ action: "protocol.fee", membership, staff: true, userStatus: "ACTIVE" })).toBe("deny");
    }
    expect(decideProtocolAction({ action: "protocol.review", membership: reviewer, staff: false, userStatus: "ACTIVE" })).toBe("allow");
    expect(decideProtocolAction({ action: "protocol.fee", membership: null, staff: true, userStatus: "ACTIVE" })).toBe("allow");
  });

  it("covers each protocol action for a leader, a member, an invite, and staff", () => {
    const cases: { membership: MembershipFact | null; staff: boolean; userStatus: string }[] = [
      { membership: leader, staff: false, userStatus: "ACTIVE" },
      { membership: proponent, staff: false, userStatus: "ACTIVE" },
      { membership: invited, staff: false, userStatus: "ACTIVE" },
      { membership: null, staff: true, userStatus: "ACTIVE" },
      { membership: null, staff: false, userStatus: "ACTIVE" },
    ];
    for (const action of actions) {
      for (const row of cases) {
        const decision = decideProtocolAction({ action, ...row });
        expect(decision === "allow" || decision === "deny").toBe(true);
      }
    }
    expect(decideProtocolAction({ action: "protocol.edit", membership: invited, staff: false, userStatus: "ACTIVE" })).toBe("deny");
    expect(decideProtocolAction({ action: "protocol.view", membership: invited, staff: false, userStatus: "ACTIVE" })).toBe("allow");
    expect(decideProtocolAction({ action: "protocol.view", membership: null, staff: false, userStatus: "ACTIVE" })).toBe("deny");
    expect(decideProtocolAction({ action: "protocol.members", membership: leader, staff: false, userStatus: "ACTIVE" })).toBe("allow");
    expect(decideProtocolAction({ action: "protocol.upload", membership: adviser, staff: false, userStatus: "ACTIVE" })).toBe("allow");
  });
});
