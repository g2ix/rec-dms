import { describe, expect, it } from "vitest";
import { applyAssessmentDefaults } from "@/lib/forms/defaults";
import { getEditableFields } from "@/lib/forms/editable";
import { validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";

const schema = validateSchema({
  sections: [
    {
      id: "assessment",
      title: "Assessment",
      fields: [
        {
          id: "points",
          label: "Points",
          type: "assessmentTable",
          fillers: ["PRIMARY_REVIEWER", "PROPONENT", "REC_CHAIR"],
          validation: { required: true },
          rows: [
            { id: "p101", code: "1.01", label: "Objectives" },
            { id: "p102", code: "1.02", label: "Methods" },
          ],
          columns: [
            {
              id: "recommendations",
              label: "Specific Recommendations",
              type: "text",
              fillers: ["PRIMARY_REVIEWER"],
              editableInSteps: ["reviewer_assess"],
              defaultValue: "No recommendations",
            },
            {
              id: "needs_action",
              label: "Needs action from researcher",
              type: "checkbox",
              fillers: ["PRIMARY_REVIEWER"],
              editableInSteps: ["reviewer_assess"],
              visibleToRoles: ["PRIMARY_REVIEWER", "REC_CHAIR"],
              requireExplicitIf: { column: "recommendations" },
            },
          ],
        },
      ],
    },
  ],
});

if (!schema.ok) throw new Error("fixture schema");

describe("needs action flag", () => {
  it("requires an explicit flag when the recommendation is not the default", () => {
    const data = {
      points: {
        p101: { recommendations: "Narrow the question." },
        p102: { recommendations: "No recommendations" },
      },
    };
    const issues = validateInstance({ schema: schema.schema }, data, {
      roles: ["PRIMARY_REVIEWER"],
      stepKey: "reviewer_assess",
    });
    expect(issues.map((issue) => issue.path)).toContain("points.p101.needs_action");
    expect(issues.map((issue) => issue.path)).not.toContain("points.p102.needs_action");
    expect(
      validateInstance(
        { schema: schema.schema },
        {
          points: {
            p101: { recommendations: "Narrow the question.", needs_action: true },
            p102: { recommendations: "No recommendations", needs_action: false },
          },
        },
        { roles: ["PRIMARY_REVIEWER"], stepKey: "reviewer_assess" },
      ),
    ).toEqual([]);
  });

  it("applies the default recommendation text to empty cells the reviewer can edit", () => {
    const next = applyAssessmentDefaults(schema.schema, { points: { p101: {} } }, ["PRIMARY_REVIEWER"], "reviewer_assess");
    expect(next).toEqual({
      points: {
        p101: { recommendations: "No recommendations" },
        p102: { recommendations: "No recommendations" },
      },
    });
    expect(applyAssessmentDefaults(schema.schema, { points: { p101: {} } }, ["PROPONENT"], "proponent_submit")).toEqual({
      points: { p101: {} },
    });
  });

  it("hides the flag column from proponents", () => {
    const editable = getEditableFields(
      { schema: schema.schema },
      { status: "DRAFT", data: { points: { p101: { recommendations: "No recommendations" } } } },
      { id: "proponent" },
      ["PROPONENT"],
      "proponent_submit",
    );
    expect([...editable].some((path) => path.endsWith(".needs_action"))).toBe(false);
  });
});
