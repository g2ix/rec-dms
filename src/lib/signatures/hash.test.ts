import { describe, expect, it } from "vitest";
import type { FormSchema } from "@/lib/forms/schema";
import { formDataHash } from "@/lib/signatures/hash";

const schema: FormSchema = {
  sections: [
    {
      id: "main",
      title: "Main",
      fields: [
        { id: "title", label: "Title", type: "text", fillers: ["PROPONENT"] },
        {
          id: "signatures",
          label: "Researchers",
          type: "signature",
          fillers: ["PROPONENT"],
          signer: { role: "PROPONENT", each: "researchers" },
        },
      ],
    },
  ],
};

describe("form data hash", () => {
  it("is independent of object key order and ignores signature fields", () => {
    const ids = ["signatures"];
    const left = formDataHash({ title: "Habits", budget: { total: 10, item: "Ink" }, signatures: { researchers: [1] } }, ids);
    const right = formDataHash({ signatures: { researchers: [2] }, budget: { item: "Ink", total: 10 }, title: "Habits" }, ids);
    expect(left).toBe(right);
    expect(formDataHash({ title: "Other", budget: { item: "Ink", total: 10 } }, ids)).not.toBe(left);
  });

  it("reads signature field ids from the schema", () => {
    expect(formDataHash({ title: "A", signatures: "sealed" }, ["signatures"])).toBe(
      formDataHash({ signatures: "changed", title: "A" }, ["signatures"]),
    );
    expect(schema.sections[0]?.fields[1]?.type).toBe("signature");
  });
});
