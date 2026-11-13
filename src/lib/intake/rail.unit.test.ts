import { describe, expect, it } from "vitest";
import { firstMissingSection, missingOnPage, railSectionOf, railSectionOfBinding, railSections } from "@/lib/intake/rail";
import { submitSummary, type SubmissionChecklist } from "@/lib/protocols/checklist";

function checklist(missing: string[], done: string[] = [], accountApproved = true): SubmissionChecklist {
  const item = (key: string, isDone: boolean) => ({ key, label: key, done: isDone, hint: null, href: null });
  const items = [...missing.map((key) => item(key, false)), ...done.map((key) => item(key, true))];
  return {
    stepName: "Submit the initial protocol",
    groups: [
      { tab: "account", label: "Account", href: null, items: [item("account.approved", accountApproved)] },
      { tab: "intake", label: "Intake", href: null, items },
    ],
    done: items.filter((entry) => entry.done).length + (accountApproved ? 1 : 0),
    total: items.length + 1,
    accountApproved,
  };
}

describe("intake rail", () => {
  it("puts every checklist item but the account in one section", () => {
    expect(railSectionOf("account.approved")).toBeNull();
    expect(railSectionOf("details.title")).toBe("study");
    expect(railSectionOf("details.study")).toBe("study");
    expect(railSectionOf("details.funding")).toBe("funding");
    expect(railSectionOf("intake.budget")).toBe("funding");
    expect(railSectionOf("forms.F-30")).toBe("funding");
    expect(railSectionOf("intake.scoping")).toBe("participants");
    expect(railSectionOf("intake.coi")).toBe("coi");
    expect(railSectionOf("intake.references")).toBe("references");
    expect(railSectionOf("forms.F-35")).toBe("references");
    expect(railSectionOf("uploads.MANUSCRIPT")).toBe("documents");
    expect(railSectionOf("intake.agreements")).toBe("sign");
    expect(railSectionOf("forms.F-27")).toBe("sign");
    expect(railSectionOf("intake.actions")).toBe("actions");
  });

  it("counts the same items as the submit check, so the rail and the submit bar never disagree", () => {
    const list = checklist(["details.title", "details.funding", "intake.budget", "intake.scoping", "uploads.MANUSCRIPT", "forms.F-27", "forms.F-28"], ["intake.coi"], false);
    const sections = railSections(list, { revision: false });
    const total = sections.reduce((sum, section) => sum + section.missing.length, 0);
    expect(total).toBe(missingOnPage(list).length);
    expect(submitSummary(list)).toBe(`${total} items left, and your account needs approval`);
    expect(sections.find((section) => section.key === "funding")?.missing).toHaveLength(2);
    expect(sections.find((section) => section.key === "sign")?.missing).toHaveLength(2);
    expect(sections.find((section) => section.key === "team")?.missing).toHaveLength(0);
    expect(firstMissingSection(sections)).toBe("study");
  });

  it("shows eight sections on a first version and Actions taken first on a revision", () => {
    expect(railSections(checklist([]), { revision: false }).map((section) => section.key)).toEqual([
      "study",
      "team",
      "funding",
      "participants",
      "coi",
      "references",
      "documents",
      "sign",
    ]);
    expect(railSections(checklist([]), { revision: true })[0]?.key).toBe("actions");
    expect(firstMissingSection(railSections(checklist([]), { revision: false }))).toBeNull();
  });

  it("links each bound value of a generated form back to where it is answered", () => {
    expect(railSectionOfBinding("protocol.title")).toBe("study");
    expect(railSectionOfBinding("protocol.researchTypeCodes")).toBe("study");
    expect(railSectionOfBinding("protocol.fundingCodes")).toBe("funding");
    expect(railSectionOfBinding("intake.budget.MOOE")).toBe("funding");
    expect(railSectionOfBinding("intake.scoping.consentNeeded")).toBe("participants");
    expect(railSectionOfBinding("intake.coi.kind")).toBe("coi");
    expect(railSectionOfBinding("intake.references")).toBe("references");
    expect(railSectionOfBinding("intake.declarations")).toBe("sign");
    expect(railSectionOfBinding("team.researchers")).toBe("team");
    expect(railSectionOfBinding("protocol.code")).toBeNull();
    expect(railSectionOfBinding("protocol.submissionDate")).toBeNull();
  });
});
