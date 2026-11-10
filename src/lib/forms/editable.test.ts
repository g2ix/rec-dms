import { describe, expect, it } from "vitest";
import { getEditableFields } from "@/lib/forms/editable";
import { sampleFormSchema } from "@/lib/forms/sample";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";

const user = { id: "user-1" };
const draft = { status: "DRAFT" as const, data: {} };

function schemaOf(input: unknown): FormSchema {
  const check = validateSchema(input);
  if (!check.ok) throw new Error(check.issues.map((issue) => issue.message).join("; "));
  return check.schema;
}

describe("editable fields", () => {
  it("lets a proponent edit their columns and leaves the reviewer column read-only", () => {
    const paths = getEditableFields({ schema: sampleFormSchema }, draft, user, ["PROPONENT"], null);
    expect(paths.has("study_title")).toBe(true);
    expect(paths.has("human_participants")).toBe(true);
    expect(paths.has("budget")).toBe(true);
    expect(paths.has("budget.item")).toBe(true);
    expect(paths.has("assessment.p101.proponent")).toBe(true);
    expect(paths.has("assessment.p101.reviewer")).toBe(false);
    expect(paths.has("budget_total")).toBe(false);
    expect(paths.has("protocol_title")).toBe(false);
  });

  it("lets a primary reviewer edit only the reviewer column", () => {
    const paths = getEditableFields({ schema: sampleFormSchema }, draft, user, ["PRIMARY_REVIEWER"], null);
    expect(paths.has("assessment.p101.reviewer")).toBe(true);
    expect(paths.has("assessment.p101.proponent")).toBe(false);
    expect(paths.has("study_title")).toBe(false);
    expect(paths.has("budget")).toBe(false);
  });

  it("honours the step, a locked copy, a hidden section, and a form locked to someone else", () => {
    const stepped = schemaOf({
      sections: [
        {
          id: "main",
          title: "Main",
          visibleIf: { "==": [{ var: "show" }, true] },
          fields: [
            {
              id: "note",
              label: "Note",
              type: "text",
              fillers: ["PROPONENT"],
              editableInSteps: ["review"],
            },
          ],
        },
      ],
    });
    expect(getEditableFields({ schema: stepped }, { status: "DRAFT", data: { show: true } }, user, ["PROPONENT"], null).size).toBe(0);
    expect(getEditableFields({ schema: stepped }, { status: "DRAFT", data: { show: true } }, user, ["PROPONENT"], "review").has("note")).toBe(true);
    expect(getEditableFields({ schema: stepped }, { status: "DRAFT", data: { show: false } }, user, ["PROPONENT"], "review").size).toBe(0);
    expect(getEditableFields({ schema: sampleFormSchema }, { status: "COMPLETE" }, user, ["PROPONENT"], null).size).toBe(0);
    expect(
      getEditableFields(
        { schema: sampleFormSchema },
        { status: "DRAFT", filledByUserId: "other" },
        user,
        ["PROPONENT"],
        null,
      ).size,
    ).toBe(0);
  });

  it("hides assessment rows that fail visibleIf", () => {
    const schema = schemaOf({
      sections: [
        {
          id: "icf",
          title: "ICF",
          fields: [
            {
              id: "points",
              label: "Points",
              type: "assessmentTable",
              fillers: ["PRIMARY_REVIEWER"],
              rows: [
                { id: "p1", code: "1", label: "Consent needed?" },
                {
                  id: "p1NO",
                  code: "1.NO",
                  label: "If NO…",
                  visibleIf: { "==": [{ var: "points.p1.assessment" }, "NO"] },
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
              ],
            },
          ],
        },
      ],
    });
    const hidden = getEditableFields(
      { schema },
      { status: "DRAFT", data: { points: { p1: { assessment: "YES" } } } },
      user,
      ["PRIMARY_REVIEWER"],
      null,
    );
    expect(hidden.has("points.p1.assessment")).toBe(true);
    expect(hidden.has("points.p1NO.assessment")).toBe(false);

    const shown = getEditableFields(
      { schema },
      { status: "DRAFT", data: { points: { p1: { assessment: "NO" } } } },
      user,
      ["PRIMARY_REVIEWER"],
      null,
    );
    expect(shown.has("points.p1NO.assessment")).toBe(true);
  });
});

