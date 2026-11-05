import { describe, expect, it } from "vitest";
import { evaluateFormula, parseFormula } from "@/lib/forms/compute";
import { recompute } from "@/lib/forms/recompute";
import { sampleFormSchema } from "@/lib/forms/sample";

describe("computed formulas", () => {
  it("sums wildcard rows, counts them, and adds a constant", () => {
    const data = { budget: [{ total: 100 }, { total: 50 }] };
    expect(evaluateFormula(parseFormula("sum(budget.*.total)"), data)).toBe(150);
    expect(evaluateFormula(parseFormula("count(budget.*)"), data)).toBe(2);
    expect(evaluateFormula(parseFormula("sum(budget.*.total) + 25"), data)).toBe(175);
    expect(evaluateFormula(parseFormula("sum(budget.*.total) / 0"), data)).toBe(0);
  });

  it("writes the sample total back onto the form", () => {
    const result = recompute(sampleFormSchema, {
      budget: [
        { _rowId: "r1", item: "Printing", total: 15000 },
        { _rowId: "r2", item: "Travel", total: 5000 },
      ],
    });
    expect(result.data.budget_total).toBe(20000);
    expect(result.changed).toContain("budget_total");
  });

  it("rejects a formula the parser cannot read", () => {
    expect(() => parseFormula("sum(")).toThrow();
  });
});
