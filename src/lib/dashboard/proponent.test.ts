import { describe, expect, it } from "vitest";
import type { PersonProfileView } from "@/lib/profile";
import type { QueueRow } from "@/server/reports/rows";
import {
  attentionItems,
  daysLeftPhrase,
  deadlineTone,
  describeActivity,
  isReturnedStatus,
  profileProgress,
  revisionLabel,
  statusDetail,
  workingDaysFromNote,
} from "@/lib/dashboard/proponent";

function profile(overrides: Partial<PersonProfileView> = {}): PersonProfileView {
  return {
    kind: "USC_ACADEMIC",
    academicLevel: "",
    institutionId: "",
    institutionName: "University of San Carlos",
    schoolId: "school",
    departmentId: "department",
    officeId: "",
    programId: "",
    institutionText: "",
    unitText: "",
    programText: "",
    yearLabel: "",
    position: "Associate Professor",
    ...overrides,
  };
}

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "task",
    href: "/app/protocols/p1",
    code: "USC-REC-2026-0123",
    title: "Sleep study",
    status: "Returned",
    step: "Revise the protocol",
    holder: "Juan D. Cruz",
    dueAt: new Date("2026-11-11T02:00:00.000Z"),
    due: "scheduled",
    note: "3 working days left",
    ...overrides,
  };
}

describe("proponent dashboard copy", () => {
  it("names the first missing profile field and why it prints", () => {
    const progress = profileProgress(profile({ position: "" }));
    expect(progress.done).toBe(2);
    expect(progress.total).toBe(3);
    expect(progress.missing).toEqual({
      label: "Rank or position",
      why: "It prints under your name on REC forms.",
    });
    expect(profileProgress(profile()).missing).toBeNull();
    expect(profileProgress(null)).toMatchObject({ done: 0, total: 1 });
  });

  it("pluralizes the revision label and groups protocol statuses", () => {
    expect(revisionLabel(0)).toBe("Revision deadlines");
    expect(revisionLabel(1)).toBe("Revision deadline");
    expect(revisionLabel(2)).toBe("Revision deadlines");
    expect(
      statusDetail([
        { status: "Approved", count: 1 },
        { status: "Under Review", count: 1 },
        { status: "Returned", count: 1 },
        { status: "Draft", count: 0 },
      ]),
    ).toBe("1 under review, 1 returned, 1 approved");
    expect(isReturnedStatus("Awaiting Revision")).toBe(true);
    expect(isReturnedStatus("Under Review")).toBe(false);
  });

  it("warns when a deadline is inside five working days", () => {
    expect(workingDaysFromNote("3 working days left")).toBe(3);
    expect(workingDaysFromNote("1 working day left")).toBe(1);
    expect(workingDaysFromNote("Due today")).toBe(0);
    expect(workingDaysFromNote("2 working days overdue")).toBe(-2);
    expect(deadlineTone(5)).toBe("warning");
    expect(deadlineTone(6)).toBeNull();
    expect(deadlineTone(-1)).toBe("danger");
    expect(daysLeftPhrase(new Date("2026-11-11T08:00:00.000Z"), new Date("2026-11-08T08:00:00.000Z"))).toBe("3 days left");
  });

  it("lists returned protocols and signature requests, soonest first", () => {
    const later = row({ id: "later", dueAt: new Date("2026-11-20T00:00:00.000Z"), note: "8 working days left" });
    const sooner = row({ id: "sooner", dueAt: new Date("2026-11-11T00:00:00.000Z") });
    const sign = row({
      id: "sign",
      status: "Draft",
      step: "A co-proponent signature on F-27",
      title: "Consent study",
      dueAt: null,
      note: null,
      openedAt: new Date("2026-11-06T00:00:00.000Z"),
      askedBy: "Ana R. Reyes",
    });
    const submit = row({ id: "submit", step: "Submit the initial protocol", dueAt: null, note: null });
    const items = attentionItems([sign, submit, sooner], [sooner, later]);
    expect(items.map((item) => item.id)).toEqual(["sooner", "later", "sign"]);
    expect(items[0]?.action).toBe("Open revision");
    expect(items[2]).toMatchObject({ action: "Sign F-27", href: "/app/protocols/p1/forms", title: "A co-proponent signature on F-27" });
  });

  it("writes activity sentences and keeps the protocol number separate", () => {
    const returned = describeActivity({
      action: "task.completed",
      actingRole: "REC_STAFF",
      actorUserId: "staff",
      viewerId: "me",
      code: "USC-REC-2026-0123",
      diff: { outcome: "RETURN_INCOMPLETE", stepKey: "staff_screening" },
    });
    expect(returned).toEqual({
      tone: "warning",
      parts: [
        { kind: "text", text: "REC Staff returned " },
        { kind: "code", text: "0123" },
        { kind: "text", text: " as incomplete" },
      ],
    });
    expect(
      describeActivity({
        action: "protocol.member_invited",
        actingRole: "PROJECT_LEADER",
        actorUserId: "leader",
        viewerId: "me",
        code: "USC-REC-2026-0141",
        diff: { role: { before: null, after: "PROPONENT" }, userId: { before: null, after: "me" } },
      })?.parts.map((part) => part.text).join(""),
    ).toBe("You were added as co-proponent on 0141");
    expect(
      describeActivity({
        action: "workflow.step_entered",
        actingRole: null,
        actorUserId: null,
        viewerId: "me",
        code: "USC-REC-2026-0098",
        diff: { stepKey: "reviewer_ack", stepName: "Acknowledge the review assignment" },
      })?.parts.map((part) => part.text).join(""),
    ).toBe("0098 was assigned to reviewers");
    expect(
      describeActivity({
        action: "task.completed",
        actingRole: "REC_CHAIR",
        actorUserId: "chair",
        viewerId: "me",
        code: "USC-REC-2026-0041",
        diff: { outcome: "APPROVED", stepKey: "chair_decide" },
      }),
    ).toMatchObject({ tone: "primary" });
    expect(
      describeActivity({
        action: "form.field_saved",
        actingRole: null,
        actorUserId: "me",
        viewerId: "me",
        code: "0123",
        diff: {},
      }),
    ).toBeNull();
  });
});
