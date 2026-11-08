import { readFileSync } from "node:fs";
import type { FormSchema } from "../../../src/lib/forms/schema";
import { FUNDING_KIND_OPTIONS, RESEARCH_TYPE_OPTIONS } from "../../../src/lib/protocols/catalog";
import { F26_ITEMS, F35_POINTS, F36_POINTS, F41_CRITERIA } from "./points";

const VERSION = "09-00";
const EFFECTIVE = "2025-08-01";
const PROPONENT = ["PROPONENT"] as const;
const ADVISER = ["ADVISER"] as const;
const STAFF = ["REC_STAFF"] as const;
const CHAIRS = ["PANEL_CHAIR", "REC_CHAIR"] as const;
const REVIEWERS = ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"] as const;
const SUBMIT_STEPS = ["proponent_submit", "proponent_revise"];
const REVIEW_STEP = ["reviewer_assess"];
const DECISION_STEPS = ["chair_decide", "chair_finalize"];
const LOCKED = ["locked"];

const yesNo = [
  { value: "YES", label: "YES" },
  { value: "NO", label: "NO" },
];
const yesNoUnable = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "UNABLE", label: "Unable to assess" },
];
const decisions = [
  { value: "APPROVED", label: "APPROVED" },
  { value: "MINOR", label: "MINOR MODIFICATIONS REQUIRED" },
  { value: "MAJOR", label: "MAJOR MODIFICATIONS REQUIRED" },
  { value: "DISAPPROVED", label: "DISAPPROVED" },
];

function meta(code: string, title: string) {
  return { code, title, versionLabel: VERSION, effectiveDate: EFFECTIVE };
}

function rowId(code: string): string {
  return `p${code.replaceAll(".", "")}`;
}

function points(items: { code: string; label: string; help?: string }[]) {
  return items.map((item) => ({ id: rowId(item.code), code: item.code, label: item.label, ...(item.help ? { help: item.help } : {}) }));
}

function area(id: string, label: string, help: string) {
  return { id, label, type: "textarea", help, naAllowedWithReason: true, fillers: [...PROPONENT] };
}

const reviewColumns = [
  { id: "page", label: "Page and paragraph number where assessment point can be found", type: "text", fillers: [...PROPONENT], editableInSteps: SUBMIT_STEPS },
  { id: "assessment", label: "Assessment", type: "select", options: yesNoUnable, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
  { id: "comments", label: "Detailed Comments/ Observations", type: "text", fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
  { id: "recommendations", label: "Specific Recommendations", type: "text", fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
];

function actionColumns(sourceForm: "F-35" | "F-36") {
  return [
    { id: "page", label: "Page and paragraph number", type: "text", fillers: [...PROPONENT], editableInSteps: ["proponent_revise"] },
    { id: "panel_comments", label: "Panel Comments/Recommendations", type: "text", fillers: [...PROPONENT], editableInSteps: LOCKED },
    { id: "actions_taken", label: "Actions Taken", type: "text", fillers: [...PROPONENT], editableInSteps: ["proponent_revise"] },
    {
      id: "panel_remarks",
      label: "Panel Remarks",
      type: "text",
      fillers: [...REVIEWERS],
      editableInSteps: REVIEW_STEP,
      authoredFrom: { forms: [sourceForm], field: "points", columns: ["comments", "recommendations"] },
    },
  ];
}

const moneyColumns = [
  { id: "particular", label: "Particulars", type: "text", fillers: [...PROPONENT] },
  { id: "personal", label: "Personal", type: "money", fillers: [...PROPONENT] },
  { id: "external", label: "External Source", type: "money", fillers: [...PROPONENT] },
  { id: "internal", label: "Internal Source", type: "money", fillers: [...PROPONENT] },
  { id: "total", label: "TOTAL", type: "computed", formula: "personal + external + internal", fillers: [...PROPONENT] },
];

function policyText(): string {
  const raw = readFileSync("prisma/seed/usc-rec/f28-policy.txt", "utf8");
  const start = raw.indexOf("General Privacy Statement");
  return start >= 0 ? raw.slice(start).trim() : raw.trim();
}

const rawForms: {
  code: string;
  title: string;
  versionLabel: string;
  effectiveDate: string;
  sections: { id: string; title: string; description?: string; fields: Record<string, unknown>[] }[];
}[] = [
  {
    ...meta("F-26", "Document Receipt Form"),
    sections: [
      {
        id: "receipt",
        title: "Document Receipt",
        fields: [
          {
            id: "submission_type",
            label: "Submission type",
            type: "radio",
            required: true,
            fillers: [...STAFF],
            options: [
              { value: "INITIAL", label: "Initial Submission" },
              { value: "COMPLETION", label: "Study Completion Report and Final Paper" },
              { value: "RESUBMISSION", label: "Resubmission for re-review" },
              { value: "CONTINUING", label: "Continuing Review of Approved Protocols" },
              { value: "AMENDMENT", label: "Protocol Amendments" },
              { value: "TERMINATION", label: "Protocol Termination" },
              { value: "OTHER", label: "Others: please specify" },
            ],
          },
          { id: "submission_other", label: "Others: please specify", type: "text", fillers: [...STAFF], requiredIf: { "==": [{ var: "submission_type" }, "OTHER"] } },
          {
            id: "documents",
            label: "Mandatory documents submitted",
            type: "assessmentTable",
            required: true,
            fillers: [...STAFF],
            rows: points(F26_ITEMS),
            columns: [{ id: "present", label: "Yes / No / NA", type: "yesNoNa", fillers: [...STAFF] }],
          },
          { id: "remarks", label: "Remarks", type: "textarea", fillers: [...STAFF] },
          {
            id: "received_by",
            label: "Received by",
            type: "signature",
            required: true,
            fillers: [...STAFF],
            editableInSteps: ["staff_screening"],
            signer: { role: "REC_STAFF" },
          },
          { id: "received_date", label: "Date received", type: "date", required: true, fillers: [...STAFF] },
        ],
      },
    ],
  },
  {
    ...meta("F-27", "Research Protocol Application Form"),
    sections: [
      {
        id: "application",
        title: "Application details",
        fields: [
          { id: "protocol_code", label: "Protocol code", type: "text", bind: "protocol.code", fillers: [] },
          { id: "protocol_title", label: "Protocol title", type: "text", bind: "protocol.title", fillers: [] },
          { id: "version", label: "Version number and date", type: "text", bind: "protocol.versionLabel", fillers: [] },
          { id: "researchers", label: "Researcher(s)/Proponent(s)", type: "text", bind: "protocol.researchers", fillers: [] },
          { id: "institution", label: "Institution", type: "text", bind: "protocol.institution", fillers: [] },
          { id: "address", label: "Institution address", type: "text", bind: "protocol.institutionAddress", fillers: [] },
          { id: "emails", label: "Email address(es)", type: "text", bind: "protocol.emails", fillers: [] },
          { id: "contacts", label: "Contact number(s)", type: "text", bind: "protocol.contactNumbers", fillers: [] },
          { id: "submitted_on", label: "Date of submission", type: "text", bind: "protocol.submissionDate", fillers: [] },
        ],
      },
      {
        id: "study",
        title: "Study",
        fields: [
          {
            id: "research_type",
            label: "Type of research",
            type: "checkboxes",
            fillers: [...PROPONENT],
            options: [...RESEARCH_TYPE_OPTIONS],
            validation: { required: true },
          },
          {
            id: "research_type_other",
            label: "Please specify",
            type: "text",
            fillers: [...PROPONENT],
            validation: { requiredIf: { in: ["OTHER", { var: "research_type" }] } },
          },
          { id: "duration", label: "Duration of the study", type: "text", required: true, fillers: [...PROPONENT] },
          { id: "participants", label: "Number and type of participants", type: "textarea", required: true, fillers: [...PROPONENT] },
          { id: "study_site", label: "Study site", type: "textarea", required: true, fillers: [...PROPONENT] },
          {
            id: "funds",
            label: "Source of funds",
            type: "checkboxes",
            fillers: [...PROPONENT],
            options: [...FUNDING_KIND_OPTIONS],
            validation: { required: true },
          },
          {
            id: "fund_institution",
            label: "Funding institution",
            type: "text",
            fillers: [...PROPONENT],
            validation: { requiredIf: { in: ["INSTITUTION", { var: "funds" }] } },
          },
          {
            id: "fund_agency",
            label: "Funding agency",
            type: "text",
            fillers: [...PROPONENT],
            validation: { requiredIf: { in: ["AGENCY", { var: "funds" }] } },
          },
          {
            id: "fund_other",
            label: "Other funding source",
            type: "text",
            fillers: [...PROPONENT],
            validation: { requiredIf: { in: ["OTHER", { var: "funds" }] } },
          },
          { id: "fund_amounts", label: "Amount and name of each source", type: "textarea", required: true, fillers: [...PROPONENT] },
        ],
      },
      {
        id: "declarations",
        title: "Declarations",
        fields: [
          { id: "declare_truth", label: "I/We declare that the information in this application is true and complete.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "declare_conduct", label: "I/We will conduct the study as approved and will not implement changes without REC approval.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "declare_consent", label: "I/We will obtain informed consent as described in the protocol.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "declare_privacy", label: "I/We will protect the privacy and confidentiality of participants.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "declare_report", label: "I/We will report protocol deviations, serious adverse events, and the completion of the study to the REC.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "declare_records", label: "I/We will keep research records available for monitoring by the REC.", type: "declaration", required: true, fillers: [...PROPONENT] },
          {
            id: "conflict",
            label: "Conflict of interest",
            type: "radio",
            required: true,
            fillers: [...PROPONENT],
            options: [
              { value: "NONE", label: "I/We have no conflict of interest to declare." },
              { value: "DECLARED", label: "I/We declare the following conflict of interest." },
            ],
          },
          { id: "conflict_details", label: "Conflict of interest details", type: "textarea", fillers: [...PROPONENT], requiredIf: { "==": [{ var: "conflict" }, "DECLARED"] } },
          {
            id: "proponent_signatures",
            label: "Signature of Researcher(s)/Proponent(s)",
            type: "signature",
            required: true,
            fillers: [...PROPONENT],
            editableInSteps: SUBMIT_STEPS,
            signer: { role: "PROPONENT", each: "researchers" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-28", "Data Privacy Consent Form"),
    sections: [
      {
        id: "privacy",
        title: "Data privacy",
        fields: [
          { id: "policy", label: "Privacy policy", type: "staticText", content: policyText(), fillers: [] },
          { id: "consent_collect", label: "I/We consent to the collection and processing of personal data as described above.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "consent_share", label: "I/We understand that data may be shared with the REC for ethics review and monitoring.", type: "declaration", required: true, fillers: [...PROPONENT] },
          { id: "names", label: "Name(s) of Researcher(s)/Proponent(s)", type: "text", bind: "protocol.researchers", fillers: [] },
          {
            id: "signatures",
            label: "Signature(s)",
            type: "signature",
            required: true,
            fillers: [...PROPONENT],
            editableInSteps: SUBMIT_STEPS,
            signer: { role: "PROPONENT", each: "researchers" },
          },
          { id: "signed_on", label: "Date", type: "date", required: true, fillers: [...PROPONENT] },
        ],
      },
    ],
  },
  {
    ...meta("F-29", "Capsule Proposal"),
    sections: [
      {
        id: "introduction",
        title: "Introduction",
        fields: [
          area("intro_1", "1. Background of the study", "State the background that leads to the research problem."),
          area("intro_2", "2. Statement of the problem", "State the main problem and the specific questions."),
          area("intro_3", "3. Objectives of the study", "State the general and specific objectives."),
          area("intro_4", "4. Significance of the study", "State who benefits and how."),
          area("intro_5", "5. Scope and limitations", "State what the study covers and what it does not."),
        ],
      },
      {
        id: "definitions",
        title: "Operational Definitions",
        fields: [area("definitions", "Operational Definitions", "Define the terms as they are used in this study.")],
      },
      {
        id: "methodology",
        title: "Methodology",
        fields: [
          area("method_1", "1. Research design", "Name and justify the design."),
          area("method_2", "2. Research environment", "Describe the site."),
          area("method_3", "3. Participants", "Describe who will take part and why."),
          area("method_4", "4. Sampling", "Describe how participants are chosen."),
          area("method_5", "5. Inclusion and exclusion criteria", "State who is included and excluded."),
          area("method_6", "6. Research instrument", "Describe the tools and their source."),
          area("method_7", "7. Data gathering procedure", "Describe the steps of data collection."),
          area("method_8", "8. Informed consent process", "Describe how consent, and assent where needed, is obtained."),
          area("method_9", "9. Risks and benefits", "Identify risks and how they are reduced, and the expected benefits."),
          area("method_10", "10. Privacy and confidentiality", "Describe how identity and data are protected."),
          area("method_11", "11. Duration of participation", "State how long each participant is involved."),
          area("method_12", "12. Compensation", "State any reimbursement, or that there is none."),
          area("method_13", "13. Withdrawal", "State that a participant may withdraw without penalty."),
        ],
      },
      {
        id: "analysis",
        title: "Data Analysis Plan",
        fields: [area("analysis", "Data Analysis Plan", "Describe how the data will be analyzed.")],
      },
      {
        id: "ethics",
        title: "Ethical Considerations",
        fields: [area("ethics", "Ethical Considerations", "Summarize the ethical protections for participants.")],
      },
      {
        id: "researchers",
        title: "Researchers",
        fields: [
          {
            id: "researcher_table",
            label: "Researcher(s)/Proponent(s)",
            type: "repeatingTable",
            required: true,
            minRows: 1,
            fillers: [...PROPONENT],
            columns: [
              { id: "name", label: "Name", type: "text", fillers: [...PROPONENT] },
              { id: "designation", label: "Designation / course, year, and institution", type: "text", fillers: [...PROPONENT] },
              { id: "email", label: "Email", type: "text", fillers: [...PROPONENT] },
              { id: "cv", label: "CV appendix no.", type: "text", fillers: [...PROPONENT] },
            ],
          },
        ],
      },
      {
        id: "adviser",
        title: "Adviser verification",
        fields: [
          { id: "adviser_name", label: "Name of Research Adviser", type: "text", required: true, fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          { id: "adviser_designation", label: "Designation", type: "text", required: true, fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          { id: "adviser_unit", label: "Unit", type: "text", fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          { id: "adviser_institution", label: "Institution", type: "text", required: true, fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          { id: "adviser_email", label: "Email", type: "text", required: true, fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          { id: "adviser_appendix", label: "CV appendix no.", type: "text", fillers: [...ADVISER], editableInSteps: SUBMIT_STEPS },
          {
            id: "adviser_signature",
            label: "Signature of Research Adviser",
            type: "signature",
            required: true,
            fillers: [...ADVISER],
            editableInSteps: SUBMIT_STEPS,
            signer: { role: "ADVISER" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-30", "Detailed Budget Sheet"),
    sections: [
      {
        id: "budget",
        title: "Detailed budget",
        fields: [
          { id: "external_source", label: "Name of external source", type: "text", fillers: [...PROPONENT] },
          { id: "ps", label: "Personal Services (PS)", type: "repeatingTable", required: true, minRows: 1, fillers: [...PROPONENT], columns: moneyColumns },
          { id: "mooe", label: "Maintenance and Other Operating Expenses (MOOE)", type: "repeatingTable", required: true, minRows: 1, fillers: [...PROPONENT], columns: moneyColumns },
          { id: "ethics_review_fee", label: "Ethics Review Fee", type: "money", fillers: [...PROPONENT] },
          { id: "capital", label: "Capital Outlay", type: "repeatingTable", fillers: [...PROPONENT], columns: moneyColumns },
          { id: "admin", label: "Administrative Cost", type: "repeatingTable", fillers: [...PROPONENT], columns: moneyColumns },
          { id: "ps_total", label: "PS sub-total", type: "computed", formula: "sum(ps.*.total)", format: "money", fillers: [] },
          { id: "mooe_total", label: "MOOE sub-total", type: "computed", formula: "sum(mooe.*.total) + ethics_review_fee", format: "money", fillers: [] },
          { id: "capital_total", label: "Capital Outlay sub-total", type: "computed", formula: "sum(capital.*.total)", format: "money", fillers: [] },
          { id: "admin_total", label: "Administrative Cost sub-total", type: "computed", formula: "sum(admin.*.total)", format: "money", fillers: [] },
          { id: "grand_total", label: "Grand total", type: "computed", formula: "ps_total + mooe_total + capital_total + admin_total", format: "money", fillers: [] },
        ],
      },
    ],
  },
  {
    ...meta("F-31", "Form on Determining the Type of Review"),
    sections: [
      {
        id: "determination",
        title: "Type of review",
        description: "Filled by the role assigned to this step. The seed assigns the REC Chair. Publishing a new workflow version can assign the Panel Chair instead. The risk answers do not choose the route.",
        fields: [
          {
            id: "submission_type",
            label: "Type of submission",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            options: [
              { value: "INITIAL", label: "Initial Submission" },
              { value: "CONTINUING", label: "Continuing Review" },
              { value: "AMENDMENT", label: "Protocol Amendment" },
              { value: "DEVIATION", label: "Deviation / Violations" },
              { value: "COMPLETION", label: "Study Completion" },
              { value: "TERMINATION", label: "Early Termination" },
              { value: "APPEAL", label: "Appeal" },
              { value: "SAE", label: "SAE / SUSAR" },
              { value: "OTHER", label: "Others" },
            ],
          },
          {
            id: "risk",
            label: "Risk level",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            help: "Minimal risk means the probability and magnitude of harm or discomfort anticipated are not greater in and of themselves than those ordinarily encountered in daily life or during the performance of routine physical or psychological examinations or tests (NEGRIHP 2011).",
            options: [
              { value: "NONE", label: "No risk" },
              { value: "BELOW_MINIMAL", label: "Below minimal risk" },
              { value: "MINIMAL", label: "Minimal risk" },
              { value: "GREATER", label: "Greater than minimal risk" },
            ],
          },
          {
            id: "exempt",
            label: "Does the protocol qualify for exemption from ethical review?",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            options: yesNo,
          },
          {
            id: "review_type",
            label: "Type of review",
            type: "radio",
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            requiredIf: { "==": [{ var: "exempt" }, "NO"] },
            options: [
              { value: "EXPEDITED", label: "Expedited Review" },
              { value: "FULL", label: "Full Review" },
            ],
          },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: ["determine_review"] },
          {
            id: "reviewers_note",
            label: "Designated reviewers",
            type: "staticText",
            fillers: [],
            content:
              "Reviewers are named when this step is completed. Any mix of primary reviewers and independent consultants is allowed. At least two. More than two may be added. A scientist and a non-scientist are not required places.",
          },
          {
            id: "accomplished_by",
            label: "Accomplished by",
            type: "signature",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            signer: { role: "REC_CHAIR" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-35", "Protocol Review Assessment Form"),
    sections: [
      {
        id: "instructions",
        title: "Instructions",
        fields: [
          {
            id: "instructions",
            label: "Instructions",
            type: "staticText",
            fillers: [],
            content:
              "Researcher(s)/Proponent(s): write the page and paragraph number where each assessment point can be found. Primary Reviewer and Independent Consultant: assess each point, write detailed comments and specific recommendations, and recommend an action.",
          },
        ],
      },
      {
        id: "assessment",
        title: "Assessment",
        fields: [
          { id: "points", label: "Protocol review assessment", type: "assessmentTable", required: true, fillers: [...PROPONENT, ...REVIEWERS], rows: points(F35_POINTS), columns: reviewColumns },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...REVIEWERS],
            editableInSteps: REVIEW_STEP,
            options: decisions,
          },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
          {
            id: "reviewer_signature",
            label: "Signature of Reviewer",
            type: "signature",
            required: true,
            fillers: [...REVIEWERS],
            editableInSteps: REVIEW_STEP,
            signer: { role: "PRIMARY_REVIEWER" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-36", "ICF Assessment Checklist"),
    sections: [
      {
        id: "assessment",
        title: "Informed consent assessment",
        fields: [
          { id: "points", label: "ICF assessment", type: "assessmentTable", required: true, fillers: [...PROPONENT, ...REVIEWERS], rows: points(F36_POINTS), columns: reviewColumns },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...REVIEWERS],
            editableInSteps: REVIEW_STEP,
            options: decisions,
          },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
          {
            id: "reviewer_signature",
            label: "Signature of Reviewer",
            type: "signature",
            required: true,
            fillers: [...REVIEWERS],
            editableInSteps: REVIEW_STEP,
            signer: { role: "PRIMARY_REVIEWER" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-37", "Summary of Reviewers' Comments"),
    sections: [
      {
        id: "header",
        title: "Review",
        fields: [
          {
            id: "copied_note",
            label: "How this summary is built",
            type: "staticText",
            fillers: [],
            content:
              "Comments and suggestions are copied from every Protocol Review Assessment Form and ICF Assessment Checklist. Only points that have a comment or a suggestion are shown. Those copied words cannot be edited. The deciding chair adds the recommended action and the justification.",
          },
          { id: "review_type", label: "Type of review", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
          { id: "reviewed_by", label: "Reviewed by", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
          { id: "review_date", label: "Date", type: "date", fillers: [...CHAIRS], editableInSteps: LOCKED },
        ],
      },
      {
        id: "praf",
        title: "Protocol Review Assessment Form",
        fields: [
          {
            id: "praf",
            label: "Protocol review comments",
            type: "assessmentTable",
            required: true,
            fillers: [...CHAIRS],
            showRowsWhenFilled: ["comments", "recommendations"],
            rows: points(F35_POINTS),
            columns: [
              { id: "comments", label: "Detailed Comments/ Observations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
              { id: "recommendations", label: "Specific Recommendations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
            ],
          },
        ],
      },
      {
        id: "icf",
        title: "ICF Assessment Checklist",
        fields: [
          {
            id: "icf",
            label: "ICF comments",
            type: "assessmentTable",
            required: true,
            fillers: [...CHAIRS],
            showRowsWhenFilled: ["comments", "recommendations"],
            rows: points(F36_POINTS),
            columns: [
              { id: "comments", label: "Detailed Comments/ Observations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
              { id: "recommendations", label: "Specific Recommendations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
            ],
          },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: DECISION_STEPS,
            options: decisions,
          },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: DECISION_STEPS },
        ],
      },
    ],
  },
  {
    ...meta("F-38", "Summary of Actions Taken"),
    sections: [
      {
        id: "actions",
        title: "Actions taken",
        fields: [
          {
            id: "praf",
            label: "Protocol review points",
            type: "assessmentTable",
            required: true,
            fillers: [...PROPONENT, ...REVIEWERS, ...CHAIRS],
            showRowsWhenFilled: ["panel_comments"],
            rows: points(F35_POINTS),
            columns: actionColumns("F-35"),
          },
          {
            id: "icf",
            label: "ICF points",
            type: "assessmentTable",
            required: true,
            fillers: [...PROPONENT, ...REVIEWERS, ...CHAIRS],
            showRowsWhenFilled: ["panel_comments"],
            rows: points(F36_POINTS),
            columns: actionColumns("F-36"),
          },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["chair_decide"],
            options: decisions,
          },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: ["chair_decide"] },
          {
            id: "researcher_signature",
            label: "Accomplished by Researcher",
            type: "signature",
            required: true,
            fillers: [...PROPONENT],
            editableInSteps: ["proponent_revise"],
            signer: { role: "PROPONENT", each: "researchers" },
          },
          {
            id: "adviser_signature",
            label: "Reviewed by Research Adviser",
            type: "signature",
            required: true,
            fillers: [...ADVISER],
            editableInSteps: ["adviser_review"],
            signer: { role: "ADVISER" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-39", "Notification of REC Decision"),
    sections: [
      {
        id: "notice",
        title: "Decision",
        fields: [
          { id: "review_date", label: "Date of review", type: "date", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision", "staff_release", "staff_release_full", "staff_release_exempt"] },
          { id: "review_type", label: "Type of review", type: "text", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          { id: "submission_type", label: "Type of submission", type: "text", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          { id: "documents", label: "Documents under review, with version numbers", type: "textarea", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          {
            id: "decision",
            label: "Decision",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["chair_sign_decision"],
            options: [
              { value: "APPROVED", label: "Approved" },
              { value: "MINOR", label: "Minor modifications required" },
              { value: "MAJOR", label: "Major modifications required" },
              { value: "DISAPPROVED", label: "Disapproved" },
              { value: "EXEMPTED", label: "Exempted" },
            ],
          },
          {
            id: "instructions",
            label: "Instructions",
            type: "textarea",
            fillers: [...STAFF, ...CHAIRS],
            editableInSteps: ["chair_sign_decision"],
            help: "Approved: The certification of approval is attached. Read it. Modifications: Revise the protocol, highlighting the changes, and submit by the deadline. Complete F-38 in Word with the actions taken, not only page numbers. Put the version number and date in the filename and the footer. Failure to resubmit within 30 working days means the protocol must be reapplied. A request for extension is a formal letter to the Panel Chair within the revision period. Disapproved: the justification is copied from F-37.",
          },
          { id: "deadline", label: "Submission deadline", type: "date", fillers: [...STAFF], editableInSteps: ["chair_sign_decision"] },
          { id: "justification", label: "Justification (if disapproved)", type: "textarea", fillers: [...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          {
            id: "chair_signature",
            label: "Signature over printed name, USC Panel Chair",
            type: "signature",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["chair_sign_decision"],
            signer: { role: "REC_CHAIR" },
          },
        ],
      },
    ],
  },
  {
    ...meta("F-41", "Checklist for Exemption from Ethical Review"),
    sections: [
      {
        id: "checklist",
        title: "Exemption checklist",
        description: "Accomplished by the Panel Chair.",
        fields: [
          {
            id: "criteria",
            label: "Criteria",
            type: "assessmentTable",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["exemption_check"],
            rows: points(F41_CRITERIA),
            columns: [
              { id: "answer", label: "YES / NO", type: "select", options: [...yesNo, { value: "NA", label: "N/A" }], fillers: [...CHAIRS], editableInSteps: ["exemption_check"] },
              { id: "comments", label: "Comments", type: "text", fillers: [...CHAIRS], editableInSteps: ["exemption_check"] },
            ],
          },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["exemption_check"],
            options: [
              { value: "QUALIFIED", label: "QUALIFIED FOR EXEMPTION" },
              { value: "NOT_QUALIFIED", label: "NOT QUALIFIED FOR EXEMPTION" },
            ],
          },
          { id: "summary", label: "Summary of recommendations", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: ["exemption_check"] },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: ["exemption_check"] },
          {
            id: "chair_signature",
            label: "Signature of Panel Chair",
            type: "signature",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["exemption_check"],
            signer: { role: "PANEL_CHAIR" },
          },
        ],
      },
    ],
  },
];

function normalizeField(raw: Record<string, unknown>): Record<string, unknown> {
  const validation: Record<string, unknown> = {};
  if (raw.required === true) validation.required = true;
  if (raw.requiredIf != null) validation.requiredIf = raw.requiredIf;
  if (raw.naAllowedWithReason === true) validation.naAllowedWithReason = true;
  const help = [raw.help, raw.content].filter((part) => typeof part === "string" && part.trim()).join("\n\n");
  const columns = Array.isArray(raw.columns)
    ? raw.columns.filter((column) => column && typeof column === "object" && (column as { type?: string }).type !== "signature")
    : undefined;
  const field: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (["required", "requiredIf", "naAllowedWithReason", "content", "format", "minRows", "columns"].includes(key)) continue;
    field[key] = value;
  }
  if (help) field.help = help;
  if (Object.keys(validation).length > 0) field.validation = validation;
  if (columns) field.columns = columns;
  return field;
}

export type UscForm = {
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  schema: FormSchema;
};

export const uscForms: UscForm[] = rawForms.map((form) => ({
  code: form.code,
  title: form.title,
  version: form.versionLabel,
  effectiveDate: form.effectiveDate,
  schema: {
    sections: form.sections.map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.description ? { description: section.description } : {}),
      fields: section.fields.map((field) => normalizeField(field)),
    })),
  } as FormSchema,
}));

export { EFFECTIVE, VERSION };
