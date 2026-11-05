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
