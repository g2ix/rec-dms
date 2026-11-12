import type { FormSchema } from "../../../src/lib/forms/schema";
import { FUNDING_KIND_OPTIONS, RESEARCH_TYPE_OPTIONS } from "../../../src/lib/protocols/catalog";
import { normalizeField, uscForms, type UscForm } from "./forms";
import { uscForms2026 } from "./forms-2026-11";
import { F27_COI, F27_DECLARATIONS, F28_CONSENTS } from "../../../src/lib/intake/wording";

export { F27_COI, F27_DECLARATIONS, F28_CONSENTS };

/**
 * Version 11-01 (INTAKE-01): F-26, F-27, F-28, F-30, F-35, F-36 and F-38 as outputs of the intake.
 * The proponents answer the Details page and the intake once per protocol version; every
 * proponent field below is a binding (`bind`) to protocol.*, intake.*, team.* or system.* and is
 * read-only. The copies store only what reviewers, staff and the chair enter.
 *
 * `effectiveDate` stays the date printed on each Word file. The stored name 11-01 is free for
 * every code; older copies keep 09-01, 10-01 (2025) or 09-02, 10-00, 10-02 (M14) and their data.
 */

export const INTAKE_VERSION = "11-01";

const PROPONENT = ["PROPONENT"] as const;
const CHAIRS = ["PANEL_CHAIR", "PANEL_VICE_CHAIR", "REC_CHAIR"] as const;
const REVIEWERS = ["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"] as const;
/** Everyone who may see reviewer columns, the recommended action and reviewer names. Not proponents or advisers. */
const COMMITTEE = [...REVIEWERS, ...CHAIRS, "PANEL_SECRETARY", "REC_STAFF"] as const;
const SUBMIT_STEPS = ["proponent_submit", "exempt_revise", "proponent_revise"];

type RawField = Record<string, unknown>;

function bound(id: string, label: string, bind: string, extra: RawField = {}): RawField {
  return { id, label, type: "text", bind, fillers: [], ...extra };
}

function header(): RawField[] {
  return [
    bound("protocol_code", "Protocol Code", "protocol.code"),
    bound("protocol_title", "Protocol Title", "protocol.title"),
    bound("version", "Ver.", "protocol.versionLabel"),
    bound("researchers", "Researcher(s)/Proponent(s)", "protocol.researchers"),
  ];
}

function schemaOf(sections: { id: string; title: string; description?: string; fields: RawField[] }[]): FormSchema {
  return {
    source: "intake",
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.description ? { description: section.description } : {}),
      fields: section.fields.map((field) => normalizeField(field)),
    })),
  } as FormSchema;
}

function base2026(code: string): UscForm {
  const form = uscForms2026.find((item) => item.code === code);
  if (!form) throw new Error(`${code} is missing from the November 2026 set.`);
  return structuredClone(form);
}

function f26(): UscForm {
  const form = base2026("F-26");
  return { ...form, version: INTAKE_VERSION, schema: { source: "intake", ...form.schema } as FormSchema };
}

function f27(): UscForm {
  const base = base2026("F-27");
  return {
    code: "F-27",
    title: base.title,
    version: INTAKE_VERSION,
    effectiveDate: base.effectiveDate,
    schema: schemaOf([
      {
        id: "application",
        title: "Application details",
        description: "For protocols with multiple researchers/proponents, the designated project leader must be listed first in the roster of names.",
        fields: [
          bound("submitted_on", "Date of Submission to USC REC", "protocol.submissionDate"),
          ...header(),
          bound("contacts", "Contact No. of Researcher(s)/ Proponent(s)", "protocol.contactNumbers"),
          bound("emails", "Email of Researcher(s)/ Proponent(s)", "protocol.emails"),
          bound("institution", "Institution", "protocol.institution"),
          bound("address", "Institution Address", "protocol.institutionAddress"),
        ],
      },
      {
        id: "study",
        title: "Study",
        fields: [
          bound("research_type", "Research Type", "protocol.researchTypeCodes", { type: "checkboxes", options: [...RESEARCH_TYPE_OPTIONS] }),
          bound("research_type_other", "Others: please specify", "protocol.researchTypeOther"),
          bound("duration", "Approximate Duration of the Study in months", "protocol.durationMonths"),
          bound("participants", "Expected number of participant(s)", "protocol.expectedParticipants"),
          bound("study_site", "Study Site", "protocol.studySite"),
          bound("funds", "Source(s) of Funds", "protocol.fundingCodes", { type: "checkboxes", options: [...FUNDING_KIND_OPTIONS] }),
          bound("fund_agency", "Agency other than institution", "protocol.fundingDetail.AGENCY"),
          bound("fund_institution", "Institution-funded", "protocol.fundingDetail.INSTITUTION"),
          bound("fund_other", "Others", "protocol.fundingDetail.OTHER"),
        ],
      },
      {
        id: "declarations",
        title: "Declaration(s) by the Researcher(s)/Proponent(s)",
        description: "Each researcher agrees to these declarations on the intake, then signs below. A box prints ticked when every researcher has agreed.",
        fields: [
          ...F27_DECLARATIONS.map((text, index) => ({ id: `declaration_${index + 1}`, label: text, type: "staticText", fillers: [] })),
          bound("conflict", "Conflict of Interest (COI)", "intake.coi.kind", {
            type: "radio",
            options: [
              { value: "NONE", label: F27_COI.NONE },
              { value: "SPECIFY", label: F27_COI.SPECIFY },
            ],
          }),
          bound("conflict_details", "Conflict of interest details", "intake.coi.text"),
          {
            id: "proponent_signatures",
            label: "Signature of Proponents/ Researchers",
            type: "signature",
            required: true,
            fillers: [...PROPONENT],
            editableInSteps: SUBMIT_STEPS,
            signer: { role: "PROPONENT", each: "researchers", agreement: "DECLARATIONS" },
          },
        ],
      },
    ]),
  };
}

function f28(): UscForm {
  const base = uscForms.find((item) => item.code === "F-28");
  if (!base) throw new Error("F-28 is missing from the 2025 seed.");
  const policy = base.schema.sections[0]?.fields.find((field) => field.id === "policy");
  if (!policy) throw new Error("F-28 policy text is missing.");
  const schema = schemaOf([
    {
      id: "privacy",
      title: "Data privacy",
      fields: [
        ...header(),
        ...F28_CONSENTS.map((text, index) => ({ id: `consent_${index + 1}`, label: text, type: "staticText", fillers: [] })),
        {
          id: "signatures",
          label: "Signature(s)",
          type: "signature",
          required: true,
          fillers: [...PROPONENT],
          editableInSteps: SUBMIT_STEPS,
          signer: { role: "PROPONENT", each: "researchers", agreement: "F28_CONSENT" },
        },
      ],
    },
  ]);
  // The General Privacy Statement, as printed, ahead of the consents.
  schema.sections[0]!.fields.splice(4, 0, structuredClone(policy));
  return { code: "F-28", title: base.title, version: INTAKE_VERSION, effectiveDate: base2026("F-28").effectiveDate, schema };
}

const moneyColumns = [
  { id: "particular", label: "Particulars", type: "text", fillers: [...PROPONENT] },
  { id: "personal", label: "Personal", type: "money", fillers: [...PROPONENT] },
  { id: "external", label: "External Source*", type: "money", fillers: [...PROPONENT] },
  { id: "internal", label: "Internal Source*", type: "money", fillers: [...PROPONENT] },
  { id: "total", label: "TOTAL", type: "money", fillers: [...PROPONENT] },
];

function f30(): UscForm {
  const base = base2026("F-30");
  const table = (id: string, label: string, bind: string): RawField => ({ id, label, type: "repeatingTable", bind, fillers: [], columns: moneyColumns });
  return {
    code: "F-30",
    title: base.title,
    version: INTAKE_VERSION,
    effectiveDate: base.effectiveDate,
    schema: schemaOf([
      {
        id: "budget",
        title: "Detailed budget",
        description: "*External Source – outside your affiliated institution; Internal Source – affiliated institution.",
        fields: [
          ...header(),
          bound("external_source", "Name of external source", "intake.budget.externalSource"),
          table("ps", "I. Personnel Services (PS)", "intake.budget.PS"),
          table("mooe", "II. Maintenance and Other Operating Expenses (MOOE)", "intake.budget.MOOE"),
          table("capital", "III. Capital Outlay", "intake.budget.CAPITAL"),
          table("admin", "IV. Administrative Cost", "intake.budget.ADMIN"),
          { id: "ps_total", label: "Sub-total for PS", type: "computed", formula: "sum(ps.*.total)", format: "money", fillers: [] },
          { id: "mooe_total", label: "Sub-total for MOOE", type: "computed", formula: "sum(mooe.*.total)", format: "money", fillers: [] },
          { id: "capital_total", label: "Sub-total for Capital Outlay", type: "computed", formula: "sum(capital.*.total)", format: "money", fillers: [] },
          { id: "admin_total", label: "Sub-total for Administrative Cost", type: "computed", formula: "sum(admin.*.total)", format: "money", fillers: [] },
          { id: "grand_total", label: "GRAND TOTAL", type: "computed", formula: "ps_total + mooe_total + capital_total + admin_total", format: "money", fillers: [] },
        ],
      },
    ]),
  };
}

/** F-35 and F-36 points with no page and line cell on the Word file. */
const NO_REFERENCE: Record<string, string[]> = { "F-35": ["4"], "F-36": ["1", "1.NO", "D"] };

/** F-35 and F-36: the proponent column reads intake.references; the reviewer columns are hidden from proponents. */
function assessment(code: "F-35" | "F-36"): UscForm {
  const form = base2026(code);
  const schema = structuredClone(form.schema) as FormSchema;
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.type === "assessmentTable") {
        for (const row of field.rows ?? []) {
          if (NO_REFERENCE[code]!.includes(row.code)) row.reference = false;
        }
        field.columns = (field.columns ?? []).map((column) => {
          if (column.id === "page") {
            return { id: "page", label: "Page & Line No. (p. __, line __)", type: "text", fillers: [...PROPONENT], bind: "intake.references" };
          }
          return column.visibleToRoles ? column : { ...column, visibleToRoles: [...COMMITTEE] };
        });
        continue;
      }
      if (field.type === "staticText") continue;
      // Recommended action, justification, reviewer's name, date and signature: committee only.
      field.visibleToRoles = [...COMMITTEE];
    }
  }
  return { ...form, version: INTAKE_VERSION, schema: { source: "intake", ...schema } as FormSchema };
}

/** F-38: rows for the flagged points only; Actions Taken (page and paragraph) reads intake.actions. */
function f38(): UscForm {
  const form = base2026("F-38");
  const schema = structuredClone(form.schema) as FormSchema;
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.type === "assessmentTable") {
        field.columns = (field.columns ?? []).map((column) => {
          if (column.id === "actions_taken") {
            return {
              id: "actions_taken",
              label: "Actions Taken (To Include Page and Paragraph Number)",
              type: "text",
              fillers: [...PROPONENT],
              bind: "intake.actions",
            };
          }
          // The panel's comments are copied in by the workflow; proponents read them but do not fill them.
          if (column.id === "panel_comments") return { ...column, fillers: [...REVIEWERS] };
          return column;
        });
        continue;
      }
      if (field.type === "signature") continue;
      if (/reviewer|recommended_action|icf_action|justification|review_date/.test(field.id)) field.visibleToRoles = [...COMMITTEE];
    }
  }
  return { ...form, version: INTAKE_VERSION, schema: { source: "intake", ...schema } as FormSchema };
}

export const uscForms11: UscForm[] = [f26(), f27(), f28(), f30(), assessment("F-35"), assessment("F-36"), f38()];

/** Codes whose M14 versions 11-01 replaces. The other M14 versions (F-31, F-37, F-39 to F-42) stay. */
export const REPLACED_BY_11 = uscForms11.map((form) => form.code);

/** Retired from the start of the November process: not created for new protocols, old copies stay readable. */
export const RETIRED_FORMS = ["F-29"];

