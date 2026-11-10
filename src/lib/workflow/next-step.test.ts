import { describe, expect, it } from "vitest";
import { completionTitle, durationPhrase, nextStepSentence, type NextTask } from "@/lib/workflow/next-step";

const viewer = "viewer";
const formatDate = () => "12 Nov 2026";

function task(patch: Partial<NextTask>): NextTask {
  return { stepName: "Screen the submission", assigneeUserId: null, assigneeName: null, roleLabel: null, dueAt: null, deadline: null, ...patch };
}

describe("nextStepSentence", () => {
  it("names the role and the step's deadline", () => {
    const line = nextStepSentence(
      [task({ roleLabel: "REC Staff", assigneeUserId: "staff", assigneeName: "Ana Reyes", deadline: { amount: 2, unit: "CALENDAR_DAYS" }, dueAt: new Date() })],
      viewer,
      formatDate,
    );
    expect(line).toBe("REC Staff acts next: Screen the submission, within 2 days (by 12 Nov 2026).");
  });

  it("names a person when the task belongs to one", () => {
    const line = nextStepSentence([task({ stepName: "Revise the protocol", assigneeUserId: "leader", assigneeName: "Juan D. Cruz" })], viewer, formatDate);
    expect(line).toBe("Juan D. Cruz acts next: Revise the protocol.");
  });

  it("says You when the viewer holds the next task", () => {
    const line = nextStepSentence([task({ assigneeUserId: viewer, assigneeName: "Me" })], viewer, formatDate);
    expect(line).toBe("You act next: Screen the submission.");
  });

  it("lists each person once and keeps masked names as given", () => {
    const line = nextStepSentence(
      [
        task({ stepName: "Assess the protocol", assigneeUserId: "a", assigneeName: "Reviewer" }),
        task({ stepName: "Assess the protocol", assigneeUserId: "b", assigneeName: "Reviewer" }),
        task({ stepName: "Assess the protocol", assigneeUserId: viewer, assigneeName: "Me" }),
      ],
      viewer,
      formatDate,
    );
    expect(line).toBe("You and Reviewer act next: Assess the protocol.");
  });

  it("uses the due date alone when the step has no deadline of its own", () => {
    const line = nextStepSentence([task({ roleLabel: "Panel Chair", dueAt: new Date() })], viewer, formatDate);
    expect(line).toBe("Panel Chair acts next: Screen the submission, by 12 Nov 2026.");
  });

  it("still names the step when nobody can be shown", () => {
    expect(nextStepSentence([task({})], viewer, formatDate)).toBe("Next step: Screen the submission.");
  });

  it("returns nothing when no task is open", () => {
    expect(nextStepSentence([], viewer, formatDate)).toBeNull();
  });
});

describe("completionTitle", () => {
  const base = { stepName: "Screen the submission", outcomeLabel: null, isReturn: false, isSubmission: false, leaderName: "Juan D. Cruz", hasComment: false };

  it("names the leader on a return and mentions the comment only when one was left", () => {
    expect(completionTitle({ ...base, outcomeLabel: "Return incomplete", isReturn: true, hasComment: true })).toBe(
      "Returned to Juan D. Cruz with your comment.",
    );
    expect(completionTitle({ ...base, outcomeLabel: "Return incomplete", isReturn: true })).toBe("Returned to Juan D. Cruz.");
  });

  it("words the leader's first step as a submission", () => {
    expect(completionTitle({ ...base, isSubmission: true })).toBe("Protocol submitted.");
  });

  it("uses the outcome label, then the step name alone", () => {
    expect(completionTitle({ ...base, outcomeLabel: "Accept" })).toBe("Screen the submission: Accept.");
    expect(completionTitle(base)).toBe("Completed: Screen the submission.");
  });
});

describe("durationPhrase", () => {
  it("words each unit in the singular and the plural", () => {
    expect(durationPhrase({ amount: 1, unit: "WORKING_DAYS" })).toBe("1 working day");
    expect(durationPhrase({ amount: 48, unit: "HOURS" })).toBe("48 hours");
    expect(durationPhrase({ amount: 14, unit: "CALENDAR_DAYS" })).toBe("14 days");
  });
});
