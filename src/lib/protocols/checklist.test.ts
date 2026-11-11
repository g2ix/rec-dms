import { describe, expect, it } from "vitest";
import { isReady, mergeActivity, submitSummary, tabCounts, type SubmissionChecklist } from "@/lib/protocols/checklist";

function checklist(accountApproved: boolean, formsDone: boolean[]): SubmissionChecklist {
  const groups: SubmissionChecklist["groups"] = [
    { tab: "account", label: "Account", href: null, items: [{ key: "a", label: "Approved", done: accountApproved, hint: null, href: null }] },
    {
      tab: "forms",
      label: "Forms",
      href: "/forms",
      items: formsDone.map((done, index) => ({ key: `f${index}`, label: `F-${index}`, done, hint: null, href: "/forms" })),
    },
  ];
  const all = groups.flatMap((group) => group.items);
  return { stepName: "Submit the initial protocol", groups, done: all.filter((item) => item.done).length, total: all.length, accountApproved };
}

describe("submission checklist", () => {
  it("says what is left and whether the account is the blocker", () => {
    expect(submitSummary(checklist(false, [false, true, false]))).toBe("2 items left, and your account needs approval");
    expect(submitSummary(checklist(true, [false]))).toBe("1 item left");
    expect(submitSummary(checklist(false, [true]))).toBe("Your account needs approval");
    expect(submitSummary(checklist(true, [true]))).toBe("Ready to submit");
  });

  it("is ready only when every item is done", () => {
    expect(isReady(checklist(true, [true, true]))).toBe(true);
    expect(isReady(checklist(false, [true, true]))).toBe(false);
  });

  it("counts missing items per tab", () => {
    expect(tabCounts(checklist(true, [false, false, true]))).toEqual({ account: 0, forms: 2 });
    expect(tabCounts(null)).toEqual({});
  });

  it("merges consecutive repeats by the same person, newest first", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 11, minute));
    const merged = mergeActivity([
      { id: "4", label: "Shared details saved", who: "Ana", at: at(54) },
      { id: "3", label: "Shared details saved", who: "Ana", at: at(52) },
      { id: "2", label: "Shared details saved", who: "Ana", at: at(50) },
      { id: "1", label: "Protocol created", who: "Ana", at: at(40) },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "4", count: 3, first: at(50), last: at(54) });
    expect(merged[1]).toMatchObject({ id: "1", count: 1 });
  });
});
