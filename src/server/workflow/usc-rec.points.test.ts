import { describe, expect, it } from "vitest";
import { validateSchema } from "@/lib/forms/schema";
import { validateGraph } from "@/lib/workflow/validate";
import { uscForms } from "../../../prisma/seed/usc-rec/forms";
import { F35_POINTS, F36_POINTS } from "../../../prisma/seed/usc-rec/points";
import { initialSubmission, resubmission } from "../../../prisma/seed/usc-rec/workflows";

function rows(code: string, fieldId: string) {
  const form = uscForms.find((item) => item.code === code);
  const check = validateSchema(form?.schema);
  expect(check.ok, check.ok ? "" : check.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")).toBe(true);
  if (!check.ok) return [];
  const field = check.schema.sections.flatMap((section) => section.fields).find((item) => item.id === fieldId);
  return field?.rows ?? [];
}

describe("USC REC assessment points", () => {
  it("keeps every published form schema valid", () => {
    for (const form of uscForms) {
      const check = validateSchema(form.schema);
      expect(check.ok, check.ok ? form.code : `${form.code} ${check.issues.map((issue) => issue.message).join("; ")}`).toBe(true);
    }
  });

  it("matches the F-35 codes 1.01 through 3.10 and the other-concerns row", () => {
    const table = rows("F-35", "points");
    const numbered = F35_POINTS.filter((point) => point.code !== "4");
    expect(numbered).toHaveLength(26);
    expect(table.map((row) => row.code)).toEqual(F35_POINTS.map((point) => point.code));
    expect(table.find((row) => row.code === "1.01")?.label).toBe("Is/Are the main research question(s) reasonable?");
    expect(table.find((row) => row.code === "3.10")?.label).toContain("disposed");
    const page = uscForms.find((form) => form.code === "F-35")?.schema.sections.flatMap((section) => section.fields).find((field) => field.id === "points");
    expect(page?.columns?.find((column) => column.id === "page")?.editableInSteps).toEqual(["proponent_submit", "proponent_revise"]);
  });

  it("matches the F-36 checklist count of 1.01 through 1.18", () => {
    const table = rows("F-36", "points");
    const body = F36_POINTS.filter((point) => /^1\.(0[1-9]|1[0-8])$/.test(point.code));
    expect(body).toHaveLength(18);
    expect(table.filter((row) => /^1\.(0[1-9]|1[0-8])$/.test(row.code))).toHaveLength(18);
    expect(table.map((row) => row.code)).toEqual(F36_POINTS.map((point) => point.code));
  });

  it("accepts both workflow graphs once the forms are published", () => {
    const codes = new Set(uscForms.map((form) => form.code));
    expect(validateGraph(initialSubmission, codes)).toEqual([]);
    expect(validateGraph(resubmission, codes)).toEqual([]);
  });
});
