import type { FormSchema } from "@/lib/forms/schema";

/** Small form used to try the builder: text, NA with a reason, a budget table, an assessment, and a total. */
export const sampleFormSchema: FormSchema = {
  sections: [
    {
      id: "study",
      title: "Study",
      description: "Filled by the proponent.",
      fields: [
        {
          id: "protocol_title",
          label: "Protocol title",
          type: "text",
          bind: "protocol.title",
          fillers: ["PROPONENT"],
        },
        {
          id: "study_title",
          label: "Short title",
          type: "text",
          fillers: ["PROPONENT"],
          validation: { required: true },
        },
        {
          id: "human_participants",
          label: "Does this study involve human participants?",
          help: "If this does not apply, choose Not applicable and explain why.",
          type: "yesNoNa",
          fillers: ["PROPONENT"],
          validation: { required: true, naAllowedWithReason: true },
        },
      ],
    },
    {
      id: "budget_section",
      title: "Budget",
      description: "Amounts are in pesos.",
      fields: [
        {
          id: "budget",
          label: "Budget lines",
          help: "Add a row for each item. The total is calculated.",
          type: "repeatingTable",
          fillers: ["PROPONENT"],
          columns: [
            { id: "item", label: "Item", type: "text", fillers: ["PROPONENT"] },
            { id: "total", label: "Amount", type: "money", fillers: ["PROPONENT"] },
          ],
        },
        {
          id: "budget_total",
          label: "Total",
          type: "computed",
          formula: "sum(budget.*.total)",
          fillers: [],
        },
      ],
    },
    {
      id: "review",
      title: "Assessment",
      description: "The proponent fills the Proponent column. The primary reviewer fills the Reviewer column.",
      fields: [
        {
          id: "assessment",
          label: "Assessment points",
          type: "assessmentTable",
          fillers: ["PROPONENT", "PRIMARY_REVIEWER"],
          columns: [
            { id: "proponent", label: "Proponent", type: "text", fillers: ["PROPONENT"] },
            { id: "reviewer", label: "Reviewer", type: "text", fillers: ["PRIMARY_REVIEWER"] },
          ],
          rows: [
            {
              id: "p101",
              code: "1.01",
              label: "Objectives are clear",
              help: "Page and paragraph for the proponent. Assessment for the reviewer.",
            },
          ],
        },
      ],
    },
  ],
};

export const SAMPLE_FORM_CODE = "SAMPLE";
export const SAMPLE_FORM_VERSION = "01-00";
export const SAMPLE_FORM_TITLE = "Sample assessment form";
