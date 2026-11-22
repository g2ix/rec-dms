import { describe, expect, it } from "vitest";
import { noticeRoleView, viewsOfRule } from "@/lib/notifications/role";

describe("which role a notification is for", () => {
  it("leaves it untagged for an account with one role", () => {
    expect(noticeRoleView({ templateKey: "task.assigned", held: ["proponent"], taskRule: { kind: "PROTOCOL_LEADER" } })).toBeNull();
  });

  it("follows the task's assignee rule", () => {
    const held = ["proponent", "reviewer", "staff"] as const;
    expect(noticeRoleView({ templateKey: "task.assigned", held: [...held], taskRule: { kind: "ROLE", role: "REC_STAFF" }, memberRole: "PROPONENT" })).toBe("staff");
    expect(noticeRoleView({ templateKey: "task.assigned", held: [...held], taskRule: { kind: "ASSIGNED_IN_STEP", stepKey: "review" } })).toBe("reviewer");
    expect(noticeRoleView({ templateKey: "task.due_soon", held: [...held], taskRule: { kind: "PROTOCOL_LEADER" } })).toBe("proponent");
  });

  it("uses the person's place on the protocol when there is no task", () => {
    expect(noticeRoleView({ templateKey: "protocol.decision_released", held: ["proponent", "adviser", "staff"], memberRole: "ADVISER" })).toBe("adviser");
    expect(noticeRoleView({ templateKey: "protocol.returned_for_revision", held: ["proponent", "staff"], memberRole: "PROPONENT" })).toBe("proponent");
  });

  it("puts staff-only notices under the staff role even on the person's own protocol", () => {
    expect(noticeRoleView({ templateKey: "conflict.declared", held: ["proponent", "staff"], memberRole: "PROPONENT", taskRule: { kind: "ASSIGNED_IN_STEP", stepKey: "r" } })).toBe("staff");
    expect(noticeRoleView({ templateKey: "task.escalated", held: ["reviewer", "staff"], taskRule: { kind: "ASSIGNED_IN_STEP", stepKey: "r" } })).toBe("staff");
  });

  it("never tags a role the person cannot switch to, and keeps account notices untagged", () => {
    expect(noticeRoleView({ templateKey: "task.assigned", held: ["proponent", "adviser"], taskRule: { kind: "ROLE", role: "REC_STAFF" } })).toBeNull();
    expect(noticeRoleView({ templateKey: "account.approved", held: ["proponent", "reviewer"] })).toBeNull();
  });

  it("an explicit role from the sender wins when the person holds it", () => {
    expect(noticeRoleView({ templateKey: "task.assigned", held: ["proponent", "chair"], explicit: "chair", memberRole: "PROPONENT" })).toBe("chair");
    expect(noticeRoleView({ templateKey: "task.assigned", held: ["proponent", "chair"], explicit: "staff", memberRole: "PROPONENT" })).toBe("proponent");
  });

  it("reads the views of a first-available rule from each choice", () => {
    expect(viewsOfRule({ kind: "FIRST_AVAILABLE", rules: [{ kind: "ROLE", role: "REC_CHAIR" }, { kind: "ROLE", role: "REC_STAFF" }] })).toEqual(["chair", "staff"]);
  });
});
