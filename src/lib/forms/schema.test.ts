import { describe, expect, it } from "vitest";
import { sampleFormSchema } from "@/lib/forms/sample";
import { validateSchema } from "@/lib/forms/schema";

describe("form schema", () => {
  it("accepts the sample form", () => {
    const check = validateSchema(sampleFormSchema);
    expect(check.ok).toBe(true);
  });

  it("rejects a repeated field id, an unknown bind, a bad formula, and an assessment table without rows", () => {
    const repeated = validateSchema({
      sections: [
        {
          id: "main",
          title: "Main",
          fields: [
            { id: "title", label: "Title", type: "text", fillers: ["PROPONENT"] },
            { id: "title", label: "Title again", type: "text", fillers: ["PROPONENT"] },
          ],
        },
      ],
    });
    expect(repeated.ok).toBe(false);
    expect(repeated.issues.some((issue) => issue.message.includes("used more than once"))).toBe(true);

    const bind = validateSchema({
      sections: [
        {
          id: "main",
          title: "Main",
          fields: [{ id: "title", label: "Title", type: "text", fillers: ["PROPONENT"], bind: "protocol.unknown" }],
        },
      ],
    });
    expect(bind.ok).toBe(false);
    expect(bind.issues.some((issue) => issue.message.includes("not a shared protocol field"))).toBe(true);

    const formula = validateSchema({
      sections: [
        {
          id: "main",
          title: "Main",
          fields: [{ id: "total", label: "Total", type: "computed", formula: "sum(", fillers: [] }],
        },
      ],
    });
    expect(formula.ok).toBe(false);

    const table = validateSchema({
      sections: [
        {
          id: "main",
          title: "Main",
          fields: [
            {
              id: "points",
              label: "Points",
              type: "assessmentTable",
              fillers: ["PROPONENT"],
              columns: [{ id: "note", label: "Note", type: "text", fillers: ["PROPONENT"] }],
            },
          ],
        },
      ],
    });
    expect(table.ok).toBe(false);
    expect(table.issues.some((issue) => issue.message.includes("at least one row"))).toBe(true);
  });
});
