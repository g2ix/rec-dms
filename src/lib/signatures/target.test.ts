import { describe, expect, it } from "vitest";
import type { FormSchema } from "@/lib/forms/schema";
import { canSignSlot, missingRequiredSignatures, signatureSlots } from "@/lib/signatures/target";

const schema: FormSchema = {
  sections: [
    {
      id: "sign",
      title: "Signatures",
      fields: [
        {
          id: "signatures",
          label: "Researcher signatures",
          type: "signature",
          fillers: ["PROPONENT"],
          signer: { role: "PROPONENT", each: "researchers" },
          validation: { required: true },
        },
        {
          id: "adviser_signature",
          label: "Adviser",
          type: "signature",
          fillers: ["ADVISER"],
          signer: { role: "ADVISER" },
          validation: { required: true },
        },
      ],
    },
  ],
};

const members = [
  { userId: "leader", role: "PROPONENT", isLeader: true, rosterOrder: 1, status: "ACTIVE", displayName: "Juan D. Cruz" },
  { userId: "co", role: "PROPONENT", isLeader: false, rosterOrder: 2, status: "ACTIVE", displayName: "Ana Reyes" },
  { userId: "adviser", role: "ADVISER", isLeader: false, rosterOrder: 3, status: "ACTIVE", displayName: "Luis Garcia" },
  { userId: "gone", role: "PROPONENT", isLeader: false, rosterOrder: 4, status: "REMOVED", displayName: "Old Name" },
];

describe("signature targeting", () => {
  it("gives each proponent a roster slot and the adviser their own field", () => {
    const slots = signatureSlots(schema, members);
    expect(slots.map((slot) => [slot.fieldPath, slot.userId])).toEqual([
      ["signatures.researchers[0]", "leader"],
      ["signatures.researchers[1]", "co"],
      ["adviser_signature", "adviser"],
    ]);
  });

  it("lets only the named person sign, and only when their role fills the field", () => {
    const slots = signatureSlots(schema, members);
    const researcher = schema.sections[0]!.fields[0]!;
    const adviser = schema.sections[0]!.fields[1]!;
    const leaderSlot = slots[0]!;
    const adviserSlot = slots[2]!;
    expect(canSignSlot(researcher, leaderSlot, { userId: "leader", roles: ["PROPONENT", "PROJECT_LEADER"] })).toBe(true);
    expect(canSignSlot(researcher, leaderSlot, { userId: "co", roles: ["PROPONENT"] })).toBe(false);
    expect(canSignSlot(adviser, adviserSlot, { userId: "adviser", roles: ["ADVISER"] })).toBe(true);
    expect(canSignSlot(adviser, adviserSlot, { userId: "leader", roles: ["PROPONENT", "PROJECT_LEADER"] })).toBe(false);
    expect(canSignSlot(researcher, leaderSlot, { userId: "leader", roles: ["ADVISER"] })).toBe(false);
  });

  it("treats a voided signature as missing when the field is required", () => {
    const missing = missingRequiredSignatures(schema, members, [
      { fieldPath: "signatures.researchers[0]", voidedAt: new Date() },
      { fieldPath: "signatures.researchers[1]", voidedAt: null },
    ]);
    expect(missing.map((slot) => slot.fieldPath)).toEqual(["signatures.researchers[0]", "adviser_signature"]);
  });
});
