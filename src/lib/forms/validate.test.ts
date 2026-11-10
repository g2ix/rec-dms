import { describe, expect, it } from "vitest";
import { validateSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";

const schema = validateSchema({
  sections: [
    {
      id: "hidden",
      title: "Hidden",
      visibleIf: { "==": [1, 2] },
      fields: [{ id: "secret", label: "Secret", type: "text", fillers: ["PROPONENT"], validation: { required: true } }],
    },
    {
      id: "main",
      title: "Main",
      fields: [
        { id: "conflict", label: "Has a conflict of interest", type: "declaration", fillers: ["PROPONENT"] },
        {
          id: "details",
          label: "Conflict details",
          type: "textarea",
          fillers: ["PROPONENT"],
          validation: { requiredIf: { "==": [{ var: "conflict" }, true] } },
        },
        {
          id: "na_question",
          label: "Applies?",
          type: "yesNoNa",
          fillers: ["PROPONENT"],
          validation: { naAllowedWithReason: true },
        },
      ],
    },
  ],
});

if (!schema.ok) throw new Error("fixture schema");

describe("requiredIf", () => {
  it("requires the detail only when the condition is true, and asks for an NA reason", () => {
    expect(validateInstance({ schema: schema.schema }, { conflict: false })).toEqual([]);
    const missing = validateInstance({ schema: schema.schema }, { conflict: true, details: "" });
    expect(missing.map((issue) => issue.path)).toContain("details");
    expect(validateInstance({ schema: schema.schema }, { conflict: true, details: "I advise the proponent." })).toEqual([]);
    const na = validateInstance({ schema: schema.schema }, { na_question: { choice: "NA", reason: "  " } });
    expect(na.some((issue) => issue.message.includes("Explain why"))).toBe(true);
    expect(validateInstance({ schema: schema.schema }, { conflict: true, details: "Noted", na_question: { choice: "NA", reason: "No participants." } })).toEqual([]);
  });

  it("skips a section that is not visible", () => {
    expect(validateInstance({ schema: schema.schema }, {}).some((issue) => issue.path === "secret")).toBe(false);
  });
});

const assessment = validateSchema({
  sections: [
    {
      id: "icf",
      title: "ICF",
      fields: [
        {
          id: "points",
          label: "ICF assessment",
          type: "assessmentTable",
          fillers: ["PRIMARY_REVIEWER"],
          validation: { required: true },
          rows: [
            { id: "p1", code: "1", label: "Is consent needed?" },
            {
              id: "p1NO",
              code: "1.NO",
              label: "If NO, are exemptions invoked?",
              visibleIf: { "==": [{ var: "points.p1.assessment" }, "NO"] },
              requiredIf: { "==": [{ var: "points.p1.assessment" }, "NO"] },
            },
          ],
          columns: [
            {
              id: "assessment",
              label: "Assessment",
              type: "select",
              options: [
                { value: "YES", label: "Yes" },
                { value: "NO", label: "No" },
              ],
              fillers: ["PRIMARY_REVIEWER"],
            },
            { id: "comments", label: "Comments", type: "text", fillers: ["PRIMARY_REVIEWER"] },
          ],
        },
      ],
    },
  ],
});

if (!assessment.ok) throw new Error("assessment fixture");

describe("assessment row visibleIf and requiredIf", () => {
  it("hides and skips 1.NO unless item 1 is No", () => {
    const yesOnly = validateInstance(
      { schema: assessment.schema },
      { points: { p1: { assessment: "YES", comments: "Needed" } } },
    );
    expect(yesOnly.map((issue) => issue.path)).not.toContain("points.p1NO.assessment");
    expect(yesOnly).toEqual([]);

    const missing = validateInstance(
      { schema: assessment.schema },
      { points: { p1: { assessment: "NO", comments: "Not needed" } } },
    );
    expect(missing.map((issue) => issue.path)).toContain("points.p1NO.assessment");

    const filled = validateInstance(
      { schema: assessment.schema },
      {
        points: {
          p1: { assessment: "NO", comments: "Not needed" },
          p1NO: { assessment: "YES", comments: "Exempt under guideline" },
        },
      },
    );
    expect(filled).toEqual([]);
  });
});

const researchers = validateSchema({
  sections: [
    {
      id: "researchers",
      title: "Researchers",
      fields: [
        {
          id: "researcher_table",
          label: "Researcher(s)/Proponent(s)",
          type: "repeatingTable",
          fillers: ["PROPONENT"],
          validation: { required: true },
          columns: [
            { id: "name", label: "Name", type: "text", required: true, fillers: ["PROPONENT"] },
            { id: "designation", label: "Designation", type: "text", fillers: ["PROPONENT"] },
            { id: "email", label: "Email", type: "text", required: true, fillers: ["PROPONENT"] },
            { id: "cv", label: "CV appendix no.", type: "text", fillers: ["PROPONENT"] },
          ],
        },
      ],
    },
  ],
});

if (!researchers.ok) throw new Error("researchers fixture");

describe("repeating table column required", () => {
  it("requires name and email, not the optional columns", () => {
    const missing = validateInstance(
      { schema: researchers.schema },
      { researcher_table: [{ _rowId: "1", name: "", designation: "", email: "", cv: "" }] },
    );
    expect(missing.map((issue) => issue.path)).toEqual(expect.arrayContaining(["researcher_table.0.name", "researcher_table.0.email"]));
    expect(missing.map((issue) => issue.path)).not.toContain("researcher_table.0.designation");
    expect(missing.map((issue) => issue.path)).not.toContain("researcher_table.0.cv");

    expect(
      validateInstance(
        { schema: researchers.schema },
        { researcher_table: [{ _rowId: "1", name: "Juan D. Cruz", designation: "", email: "juan@usc.edu.ph", cv: "" }] },
      ),
    ).toEqual([]);
  });
});
