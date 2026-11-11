import { describe, expect, it } from "vitest";
import { getEditableFields } from "@/lib/forms/editable";
import { findField } from "@/lib/forms/schema";
import { validateGraph } from "@/lib/workflow/validate";
import { uscForms } from "../../../prisma/seed/usc-rec/forms";
import { F35_POINTS, F36_POINTS } from "../../../prisma/seed/usc-rec/points";
import { initialSubmission, resubmission } from "../../../prisma/seed/usc-rec/workflows";

const published = new Set(uscForms.map((form) => form.code));

function form(code: string) {
  const found = uscForms.find((item) => item.code === code);
  if (!found) throw new Error(`${code} is missing from the seed.`);
  return found.schema;
}

describe("USC REC seed", () => {
  it("publishes both workflow graphs", () => {
    expect(validateGraph(initialSubmission, published)).toEqual([]);
    expect(validateGraph(resubmission, published)).toEqual([]);
  });

  it("counts the printed assessment points", () => {
    const protocol = F35_POINTS.filter((point) => /^\d\.\d{2}$/.test(point.code));
    expect(protocol).toHaveLength(26);
    expect(protocol.map((point) => point.code)).toContain("1.01");
    expect(protocol.map((point) => point.code)).toContain("3.10");
    expect(F35_POINTS.some((point) => point.label === "Do you have any other concerns?")).toBe(true);

    const consent = F36_POINTS.filter((point) => /^1\.(?:0?[1-9]|1[0-8])$/.test(point.code));
    expect(consent).toHaveLength(18);
    expect(F36_POINTS.map((point) => point.code)).toEqual(expect.arrayContaining(["2", "3", "4"]));
    const contact = F36_POINTS.find((point) => point.code === "1.15");
    expect(contact?.help).toContain("REC Chair");
    expect(contact?.help).not.toContain("Panel Chair");
  });

  it("keeps page and paragraph for the proponent's submit and revise steps", () => {
    const schema = form("F-35");
    const column = findField(schema, "points")?.columns?.find((item) => item.id === "page");
    expect(column?.editableInSteps).toEqual(["proponent_submit", "proponent_revise"]);
    const draft = { status: "DRAFT" as const, data: {} };
    const onSubmit = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "proponent_submit");
    const onRevise = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "proponent_revise");
    const onReview = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "reviewer_assess");
    expect([...onSubmit].some((path) => path.endsWith(".page"))).toBe(true);
    expect([...onRevise].some((path) => path.endsWith(".page"))).toBe(true);
    expect([...onReview].some((path) => path.endsWith(".page"))).toBe(false);
  });

  it("shows the chair only flagged points and leaves copied comments closed", () => {
    const schema = form("F-37");
    const data = {
      praf: { p101: { comments: "Reviewer 1: Narrow the question.", recommendations: "", needs_action: true } },
      icf: {},
    };
    const editable = getEditableFields({ schema }, { status: "DRAFT", data }, { id: "chair" }, ["REC_CHAIR"], "chair_decide");
    expect([...editable].some((path) => path.includes("comments") || path.includes("recommendations"))).toBe(false);
    expect(editable.has("praf.p101.needs_action")).toBe(true);
    expect(editable.has("recommended_action")).toBe(true);
    expect(editable.has("justification")).toBe(true);
    const table = findField(schema, "praf");
    expect(table?.showRowsWhenFilled).toEqual(["needs_action"]);
  });

  it("lets a reviewer remark only on points they raised", () => {
    const schema = form("F-38");
    const data = {
      praf: {
        p101: { panel_comments: "Reviewer 1: Narrow the question.", needs_action: true },
        p102: { panel_comments: "Reviewer 2: Add the site.", needs_action: true },
      },
    };
    const allowed = { "praf.panel_remarks": ["p101"], "praf.needs_action": ["p101"] };
    const editable = getEditableFields(
      { schema },
      { status: "DRAFT", data },
      { id: "reviewer" },
      ["PRIMARY_REVIEWER"],
      "reviewer_assess",
      allowed,
    );
    expect(editable.has("praf.p101.panel_remarks")).toBe(true);
    expect(editable.has("praf.p102.panel_remarks")).toBe(false);
  });

  it("hides the needs-action flag from proponents on F-35", () => {
    const schema = form("F-35");
    const column = findField(schema, "points")?.columns?.find((item) => item.id === "needs_action");
    expect(column?.visibleToRoles).toEqual(
      expect.arrayContaining(["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "PANEL_CHAIR", "REC_CHAIR", "REC_STAFF"]),
    );
    expect(column?.visibleToRoles).not.toContain("PROPONENT");
    const recommendations = findField(schema, "points")?.columns?.find((item) => item.id === "recommendations");
    expect(recommendations?.defaultValue).toBe("No recommendations");
  });

  it("assigns determine-review to the REC Chair and leaves the reviewer list open", () => {
    const step = initialSubmission.steps.find((item) => item.key === "determine_review");
    expect(step?.assignee).toEqual({ kind: "ROLE", role: "REC_CHAIR" });
    expect(step?.assignReviewers).toEqual({
      roles: ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"],
      min: 2,
    });
    const exempt = initialSubmission.steps.find((item) => item.key === "exemption_check");
    expect(exempt?.assignee).toEqual({ kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" });
    const returned = initialSubmission.transitions.find((item) => item.from === "exemption_check" && item.to === "return_not_qualified");
    expect(returned).toBeTruthy();
    expect(initialSubmission.steps.some((item) => item.sideTasks?.length)).toBe(false);
    expect(JSON.stringify(initialSubmission.transitions)).not.toContain("risk");
    const adviser = resubmission.transitions.find((item) => item.to === "adviser_review");
    expect(JSON.stringify(adviser?.when)).toContain("hasAdviser");
  });
});
