import type { FormSchema } from "../../../src/lib/forms/schema";
import { normalizeField, uscForms, type UscForm } from "./forms";
import { F41_CRITERIA, type AssessmentPoint } from "./points";
import { F26_ITEMS_10, F35_POINTS_10, F36_POINTS_10 } from "./points-2026-11";

/**
 * USC REC forms for the November 2026 process (docs/PROCESS-UPDATE-2026-11.md). Every form gets a
 * new version so a protocol started on the 2025 process keeps the versions it started with.
 *
 * `effectiveDate` is the date printed on the Word file. When the whole set starts is a separate
 * date, `PROCESS_START` in workflows-2026-11.ts, used as each version's `effectiveFrom`.
 *
 * `version` is the stored version name. It follows the printed number where that number is
 * free, and the next revision of the stored name where the 2025 seed already used it
 * (F-27, F-28, F-30, F-39 and F-41 print 09-00 and are stored as 09-02; F-35 to F-38 print 10-00
 * and are stored as 10-02, after the 10-01 needs-action fix).
 */

/** Printed dates. If the REC moves the start before 2027, change only these and PROCESS_START. */
const NEW_PRINTED = "2027-01-01";
const KEPT_PRINTED = "2025-08-01";

const PROPONENT = ["PROPONENT"] as const;
const ADVISER = ["ADVISER"] as const;
const STAFF = ["REC_STAFF"] as const;
const SECRETARY = ["PANEL_SECRETARY"] as const;
/** The deciding chair: Panel Chair, or the Vice-Chair or REC Chair on a conflict of interest. */
const CHAIRS = ["PANEL_CHAIR", "PANEL_VICE_CHAIR", "REC_CHAIR"] as const;
/** Panel members chosen for a slot join the protocol as REVIEWER. */
const REVIEWERS = ["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"] as const;
const FLAG_VIEWERS = [...REVIEWERS, ...CHAIRS, "PANEL_SECRETARY", "REC_STAFF"] as const;

const SUBMIT_STEPS = ["proponent_submit", "exempt_revise"];
const REVIEW_STEP = ["reviewer_assess"];
const CHAIR_STEPS = ["chair_review", "chair_sign_decision"];
const EXEMPT_STEPS = ["determine_review", "exemption_recheck"];
const LOCKED = ["locked"];
const NO_RECOMMENDATIONS = "No recommendations";

const yesNo = [
  { value: "YES", label: "YES" },
  { value: "NO", label: "NO" },
];
const yesNoUnable = [
  { value: "UNABLE", label: "Unable to assess" },
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
];
const decisions = [
  { value: "APPROVED", label: "APPROVED" },
  { value: "MINOR", label: "MINOR MODIFICATIONS REQUIRED" },
  { value: "MAJOR", label: "MAJOR MODIFICATIONS REQUIRED" },
  { value: "DISAPPROVED", label: "DISAPPROVED" },
];

type RawField = Record<string, unknown>;
type RawForm = { code: string; title: string; version: string; effectiveDate: string; sections: { id: string; title: string; description?: string; fields: RawField[] }[] };

function rowId(code: string): string {
  return `p${code.replaceAll(".", "")}`;
}

function rows(items: AssessmentPoint[]) {
  return items.map((item) => ({
    id: rowId(item.code),
    code: item.code,
    label: item.label,
    ...(item.help ? { help: item.help } : {}),
    ...(item.visibleIf != null ? { visibleIf: item.visibleIf } : {}),
    ...(item.requiredIf != null ? { requiredIf: item.requiredIf } : {}),
  }));
}

/** F-35 and F-36: no blank comment or recommendation on any point, and a tick for points that need revision. */
const reviewColumns = [
  {
    id: "page",
    label: "Page & line no. where the assessment point can be found",
    type: "text",
    required: true,
    fillers: [...PROPONENT],
    editableInSteps: SUBMIT_STEPS,
  },
  { id: "assessment", label: "Reviewer's assessment", type: "select", options: yesNoUnable, required: true, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
  { id: "comments", label: "Detailed Comments/Observations", type: "text", required: true, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP },
  {
    id: "recommendations",
    label: "Specific Recommendations",
    type: "text",
    required: true,
    fillers: [...REVIEWERS],
    editableInSteps: REVIEW_STEP,
    defaultValue: NO_RECOMMENDATIONS,
  },
  {
    id: "needs_action",
    label: "Needs revision",
    type: "checkbox",
    fillers: [...REVIEWERS],
    editableInSteps: REVIEW_STEP,
    visibleToRoles: [...FLAG_VIEWERS],
    requireExplicitIf: { column: "recommendations" },
  },
];

function reviewerBlock(prefix: "" | "icf_", steps: string[], label: string): RawField[] {
  return [
    {
      id: `${prefix}recommended_action`.replace(/^icf_recommended_action$/, "icf_action"),
      label: `Recommended action${label}`,
      type: "radio",
      required: true,
      fillers: [...REVIEWERS],
      editableInSteps: steps,
      options: decisions,
    },
    { id: `${prefix}justification`, label: `Justification${label}`, type: "textarea", required: true, fillers: [...REVIEWERS], editableInSteps: steps },
    { id: `${prefix}reviewer_name`, label: `Reviewer's printed name${label}`, type: "text", required: true, fillers: [...REVIEWERS], editableInSteps: steps },
    { id: `${prefix}review_date`, label: `Date${label}`, type: "date", required: true, fillers: [...REVIEWERS], editableInSteps: steps },
    {
      id: `${prefix}reviewer_signature`,
      label: `Signature of Reviewer${label}`,
      type: "signature",
      required: true,
      fillers: [...REVIEWERS],
      editableInSteps: steps,
      signer: { role: "PRIMARY_REVIEWER" },
    },
  ];
}

function assessment(code: string, title: string, points: AssessmentPoint[], instructions: string): RawForm {
  return {
    code,
    title,
    version: "10-02",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "instructions",
        title: "Instructions",
        fields: [{ id: "instructions", label: "Instructions", type: "staticText", fillers: [], content: instructions }],
      },
      {
        id: "assessment",
        title: "Assessment",
        fields: [
          {
            id: "points",
            label: title,
            type: "assessmentTable",
            required: true,
            fillers: [...PROPONENT, ...REVIEWERS, ...CHAIRS, ...STAFF],
            rows: rows(points),
            columns: reviewColumns,
          },
          ...reviewerBlock("", REVIEW_STEP, ""),
        ],
      },
    ],
  };
}

/** F-37: the reviewers' words stay; the chair's overriding comment sits beside them (REC answer, 10 Nov 2026). */
function summaryTable(id: "praf" | "icf", label: string, points: AssessmentPoint[]): RawField {
  return {
    id,
    label,
    type: "assessmentTable",
    required: true,
    fillers: [...CHAIRS],
    rows: rows(points),
    columns: [
      { id: "comments", label: "Panel/Reviewers' Comments/Observations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
      { id: "recommendations", label: "Panel/Reviewers' Recommendations", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
      {
        id: "chair_comments",
        label: "Panel Chair's comment (replaces the reviewers' comment in the copy sent to the researcher)",
        type: "text",
        required: false,
        fillers: [...CHAIRS],
        editableInSteps: CHAIR_STEPS,
        overrides: "comments",
      },
      {
        id: "chair_recommendations",
        label: "Panel Chair's recommendation (replaces the reviewers' recommendation in the copy sent to the researcher)",
        type: "text",
        required: false,
        fillers: [...CHAIRS],
        editableInSteps: CHAIR_STEPS,
        overrides: "recommendations",
      },
      {
        id: "needs_action",
        label: "Needs revision",
        type: "checkbox",
        required: false,
        fillers: [...CHAIRS],
        editableInSteps: CHAIR_STEPS,
        visibleToRoles: [...FLAG_VIEWERS],
      },
    ],
  };
}

function actionTable(id: "praf" | "icf", label: string, points: AssessmentPoint[], sourceForm: "F-35" | "F-36"): RawField {
  const authored = { forms: [sourceForm], field: "points", columns: ["comments", "recommendations", "needs_action"] };
  return {
    id,
    label,
    type: "assessmentTable",
    required: true,
    fillers: [...PROPONENT, ...REVIEWERS, ...CHAIRS, ...STAFF],
    showRowsWhenFilled: ["needs_action"],
    rows: rows(points),
    columns: [
      { id: "panel_comments", label: "Panel/Reviewers' Comments and Recommendations", type: "text", fillers: [...PROPONENT], editableInSteps: LOCKED },
      {
        id: "actions_taken",
        label: "Actions Taken (include page and paragraph number)",
        type: "text",
        required: true,
        fillers: [...PROPONENT],
        editableInSteps: ["proponent_revise"],
      },
      { id: "panel_remarks", label: "Panel/Reviewers' Remarks", type: "text", required: true, fillers: [...REVIEWERS], editableInSteps: REVIEW_STEP, authoredFrom: authored },
      {
        id: "needs_action",
        label: "Still needs revision",
        type: "checkbox",
        required: false,
        fillers: [...REVIEWERS],
        editableInSteps: REVIEW_STEP,
        visibleToRoles: [...FLAG_VIEWERS],
        authoredFrom: authored,
      },
    ],
  };
}

/**
 * F-38 has a reviewer block after each part: the scientist signs the protocol part and the
 * non-scientist the ICF part. Both reviewers hold the same role on the protocol, so the form cannot
 * require one block of one reviewer only. Each block is optional here; the remarks on the points
 * each reviewer raised are required.
 */
function optionalReviewerBlock(prefix: "" | "icf_", label: string): RawField[] {
  return reviewerBlock(prefix, REVIEW_STEP, label).map((field) => ({ ...field, required: false }));
}

function signedBy(id: string, label: string, role: string, fillers: readonly string[], steps: string[], each = false): RawField {
  return {
    id,
    label,
    type: "signature",
    required: true,
    fillers: [...fillers],
    editableInSteps: steps,
    signer: each ? { role, each: "researchers" } : { role },
  };
}

function certificateDetails(steps: string[], withMeeting: boolean): RawField[] {
  return [
    ...(withMeeting
      ? [
          { id: "review_type", label: "Type of review", type: "text", required: true, fillers: [...STAFF], editableInSteps: steps },
          { id: "meeting_date", label: "Date of REC meeting (full review)", type: "date", fillers: [...STAFF], editableInSteps: steps },
        ]
      : []),
    { id: "funds", label: "Source(s) of funds", type: "text", required: true, fillers: [...STAFF], editableInSteps: steps },
    { id: "study_site", label: "Study site", type: "text", required: true, fillers: [...STAFF], editableInSteps: steps },
    { id: "panel_number", label: "Review panel number", type: "text", required: true, fillers: [...STAFF], editableInSteps: steps },
  ];
}

const rawForms: RawForm[] = [
  {
    code: "F-26",
    title: "Document Receipt Form",
    version: "10-00",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "receipt",
        title: "Document Receipt",
        fields: [
          {
            id: "submission_type",
            label: "Type of submission",
            type: "radio",
            required: true,
            fillers: [...STAFF],
            options: [
              { value: "INITIAL", label: "Initial Submission" },
              { value: "COMPLETION", label: "Final Report and Final Paper" },
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
            rows: rows(F26_ITEMS_10),
            columns: [{ id: "present", label: "Yes / No / NA", type: "yesNoNa", fillers: [...STAFF] }],
          },
          { id: "remarks", label: "Remarks", type: "textarea", fillers: [...STAFF] },
          signedBy("received_by", "Received by", "REC_STAFF", STAFF, ["staff_screening"]),
          { id: "received_date", label: "Date received", type: "date", required: true, fillers: [...STAFF] },
        ],
      },
    ],
  },
  {
    code: "F-31",
    title: "Form on Determining the Type of Review",
    version: "10-00",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "determination",
        title: "Type of review",
        description: "Filled by the Panel Chair, or the Vice-Chair or REC Chair when the Panel Chair has a conflict of interest. The reviewers are chosen on the same step.",
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
              { value: "CONTINUING", label: "Application for Continuing Review" },
              { value: "AMENDMENT", label: "Protocol Amendment Application" },
              { value: "DEVIATION", label: "Protocol Deviation/ Violations" },
              { value: "FINAL_REPORT", label: "Final Report" },
              { value: "TERMINATION", label: "Early Termination Reports" },
              { value: "APPEAL", label: "Appeal" },
              { value: "UAP_AE", label: "UAP/AE Report" },
              { value: "OTHER", label: "Others" },
            ],
          },
          { id: "submission_other", label: "Others, please specify", type: "text", fillers: [...CHAIRS], editableInSteps: ["determine_review"], requiredIf: { "==": [{ var: "submission_type" }, "OTHER"] } },
          {
            id: "risk",
            label: "Risk to study participants",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            help: "A risk is minimal when the probability and magnitude of harm or discomfort anticipated in the proposed research are not greater, in and of themselves, than those ordinarily encountered in daily life.",
            options: [
              { value: "BELOW_MINIMAL", label: "Below minimal risk" },
              { value: "MINIMAL", label: "Minimal risk" },
              { value: "GREATER", label: "Greater than minimal risk" },
              { value: "NONE", label: "No risk" },
            ],
          },
          {
            id: "exempt",
            label: "Can the study protocol be exempt from review?",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            help: "If yes, fill out the Checklist for Exemption from Ethical Review (F-41) on this step.",
            options: yesNo,
          },
          {
            id: "review_type",
            label: "If NO, type of review",
            type: "radio",
            fillers: [...CHAIRS],
            editableInSteps: ["determine_review"],
            requiredIf: { "==": [{ var: "exempt" }, "NO"] },
            options: [
              { value: "EXPEDITED", label: "Expedited Review" },
              { value: "FULL", label: "Full Review" },
            ],
          },
          { id: "consent_needed", label: "Is informed consent needed?", type: "radio", required: true, fillers: [...CHAIRS], editableInSteps: ["determine_review"], options: yesNo },
          { id: "consent_waiver", label: "Does the researcher request waiver of consent?", type: "radio", required: true, fillers: [...CHAIRS], editableInSteps: ["determine_review"], options: yesNo },
          { id: "justification", label: "Justification", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: ["determine_review"] },
          { id: "scientist_reviewer", label: "Designated reviewer: Scientist", type: "text", fillers: [...CHAIRS], editableInSteps: ["determine_review"], help: "Printed on the form. The reviewer is assigned in the Scientist slot on this step." },
          { id: "non_scientist_reviewer", label: "Designated reviewer: Non-Scientist", type: "text", fillers: [...CHAIRS], editableInSteps: ["determine_review"], help: "Printed on the form. The reviewer is assigned in the Non-scientist slot on this step." },
          signedBy("accomplished_by", "Accomplished by", "PANEL_CHAIR", CHAIRS, ["determine_review"]),
        ],
      },
    ],
  },
  assessment(
    "F-35",
    "Protocol Review Assessment Form",
    F35_POINTS_10,
    "Researcher(s)/Proponent(s): write the page and line number where each assessment point can be found. Scientist reviewer: assess every point, and write detailed comments and specific recommendations on every point; none may be left blank. Tick Needs revision on each point the researcher must change; those points are highlighted in yellow on the printed summary. Then give the recommended action, the justification, your printed name, the date and your signature.",
  ),
  assessment(
    "F-36",
    "Informed Consent Form Assessment Checklist",
    F36_POINTS_10,
    "Researcher(s)/Proponent(s): write the page and line number where each assessment point can be found in the Informed Consent Form. Non-scientist reviewer: assess every point, and write detailed comments and specific recommendations on every point; none may be left blank. Tick Needs revision on each point the researcher must change. Then give the recommended action, the justification, your printed name, the date and your signature.",
  ),
  {
    code: "F-37",
    title: "Summary of Reviewers' Comments",
    version: "10-02",
    effectiveDate: NEW_PRINTED,
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
              "Every point is copied from the reviewers' F-35 and F-36. The reviewers' words stay as written. The Panel Chair can write a comment or a recommendation beside a point; the copy sent to the researcher prints the chair's words in place of the reviewers'. Points ticked Needs revision are highlighted in yellow on the printed form.",
          },
          { id: "review_type", label: "Type of review", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
          { id: "reviewed_by", label: "Reviewed by", type: "text", fillers: [...CHAIRS], editableInSteps: LOCKED },
          { id: "review_date", label: "Date reviewed", type: "date", fillers: [...CHAIRS], editableInSteps: LOCKED },
        ],
      },
      {
        id: "praf",
        title: "Protocol Review Assessment Form",
        fields: [
          summaryTable("praf", "Protocol review comments", F35_POINTS_10),
          { id: "recommended_action", label: "Recommended action (protocol)", type: "radio", required: true, fillers: [...CHAIRS], editableInSteps: CHAIR_STEPS, options: decisions },
          { id: "justification", label: "Justification (protocol)", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: CHAIR_STEPS },
        ],
      },
      {
        id: "icf",
        title: "Informed Consent Form (ICF) Checklist",
        fields: [
          summaryTable("icf", "ICF comments", F36_POINTS_10),
          { id: "icf_action", label: "Recommended action (ICF)", type: "radio", required: true, fillers: [...CHAIRS], editableInSteps: CHAIR_STEPS, options: decisions },
          { id: "icf_justification", label: "Justification for recommendation (ICF)", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: CHAIR_STEPS },
        ],
      },
      {
        id: "signatures",
        title: "Signatures",
        fields: [
          signedBy("prepared_by", "Form contents prepared by REC Staff", "REC_STAFF", STAFF, ["staff_sign_summary"]),
          signedBy("secretary_review", "Form contents reviewed by Panel Secretary (full review)", "PANEL_SECRETARY", SECRETARY, ["secretary_sign_summary"]),
          signedBy("chair_endorsement", "Endorsed by Panel Chair", "PANEL_CHAIR", CHAIRS, ["chair_sign_decision"]),
        ],
      },
    ],
  },
  {
    code: "F-38",
    title: "Summary of Actions Taken",
    version: "10-02",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "protocol",
        title: "Summary of actions taken on the study protocol",
        fields: [actionTable("praf", "Protocol review points still open", F35_POINTS_10, "F-35"), ...optionalReviewerBlock("", " (protocol)")],
      },
      {
        id: "icf",
        title: "Summary of actions taken on the Informed Consent Form (ICF)",
        fields: [actionTable("icf", "ICF points still open", F36_POINTS_10, "F-36"), ...optionalReviewerBlock("icf_", " (ICF)")],
      },
      {
        id: "signatures",
        title: "Signatures",
        fields: [
          signedBy("researcher_signature", "Accomplished by Researcher(s)/Proponent(s)", "PROPONENT", PROPONENT, ["proponent_revise"], true),
          signedBy("adviser_signature", "Actions taken reviewed by Adviser", "ADVISER", ADVISER, ["adviser_review"]),
        ],
      },
    ],
  },
  {
    code: "F-39",
    title: "Notification of REC Decision",
    version: "09-02",
    effectiveDate: KEPT_PRINTED,
    sections: [
      {
        id: "notice",
        title: "Decision",
        fields: [
          { id: "review_date", label: "Date of review", type: "date", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision", "staff_release"] },
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
            ],
          },
          { id: "instructions", label: "Instructions", type: "textarea", fillers: [...STAFF, ...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          { id: "deadline", label: "Submission deadline", type: "date", fillers: [...STAFF], editableInSteps: ["chair_sign_decision"] },
          { id: "justification", label: "Justification (if disapproved)", type: "textarea", fillers: [...CHAIRS], editableInSteps: ["chair_sign_decision"] },
          signedBy("chair_signature", "Signature over printed name, USC Panel Chair", "PANEL_CHAIR", CHAIRS, ["chair_sign_decision"]),
        ],
      },
    ],
  },
  {
    code: "F-40",
    title: "Certification of Approval",
    version: "09-01",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "certificate",
        title: "Certification of Approval",
        description: "The approval period, the progress report date and the continuing review date are worked out on release from the certificate settings.",
        fields: [
          ...certificateDetails(["staff_prepare_certificate"], true),
          signedBy("chair_signature", "Signature above name of Panel Chair", "PANEL_CHAIR", CHAIRS, ["chair_sign_certificate"]),
          signedBy("conforme", "Conformé: signature over printed name of researcher(s)/proponent(s)", "PROPONENT", PROPONENT, ["proponent_conform"], true),
        ],
      },
    ],
  },
  {
    code: "F-41",
    title: "Checklist for Exemption from Ethical Review",
    version: "09-02",
    effectiveDate: KEPT_PRINTED,
    sections: [
      {
        id: "checklist",
        title: "Exemption checklist",
        description: "Filled by the chair who determines the type of review, on the same step as F-31.",
        fields: [
          {
            id: "criteria",
            label: "Criteria",
            type: "assessmentTable",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: EXEMPT_STEPS,
            rows: rows(F41_CRITERIA),
            columns: [
              { id: "answer", label: "YES / NO", type: "select", options: [...yesNo, { value: "NA", label: "N/A" }], fillers: [...CHAIRS], editableInSteps: EXEMPT_STEPS },
              { id: "comments", label: "Comments", type: "text", fillers: [...CHAIRS], editableInSteps: EXEMPT_STEPS },
            ],
          },
          {
            id: "recommended_action",
            label: "Recommended action",
            type: "radio",
            required: true,
            fillers: [...CHAIRS],
            editableInSteps: EXEMPT_STEPS,
            options: [
              { value: "QUALIFIED", label: "QUALIFIED FOR EXEMPTION" },
              { value: "NOT_QUALIFIED", label: "NOT QUALIFIED FOR EXEMPTION" },
            ],
          },
          { id: "summary", label: "Summary of recommendations", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: EXEMPT_STEPS },
          { id: "justification", label: "Justification for recommended action", type: "textarea", required: true, fillers: [...CHAIRS], editableInSteps: EXEMPT_STEPS },
          signedBy("chair_signature", "Panel Chair", "PANEL_CHAIR", CHAIRS, EXEMPT_STEPS),
        ],
      },
    ],
  },
  {
    code: "F-42",
    title: "Certification of Exemption from Review",
    version: "10-00",
    effectiveDate: NEW_PRINTED,
    sections: [
      {
        id: "certificate",
        title: "Certification of Exemption from Ethical Review",
        description: "The exemption period and the continuing review date are worked out on release from the certificate settings.",
        fields: [...certificateDetails(["exempt_payment"], false), signedBy("chair_signature", "Name of Panel Chair", "PANEL_CHAIR", CHAIRS, ["exempt_sign"])],
      },
    ],
  },
];

function normalize(form: RawForm): UscForm {
  return {
    code: form.code,
    title: form.title,
    version: form.version,
    effectiveDate: form.effectiveDate,
    schema: {
      sections: form.sections.map((section) => ({
        id: section.id,
        title: section.title,
        ...(section.description ? { description: section.description } : {}),
        fields: section.fields.map((field) => normalizeField(field)),
      })),
    } as FormSchema,
  };
}

/** F-27, F-28 and F-30 are unchanged in content: new versions of the 2025 schema, printed 08/01/25. */
function carried(code: string): UscForm {
  const base = uscForms.find((form) => form.code === code);
  if (!base) throw new Error(`${code} is missing from the 2025 seed.`);
  return { ...base, version: "09-02", effectiveDate: KEPT_PRINTED, schema: structuredClone(base.schema) };
}

const ORDER = ["F-26", "F-27", "F-28", "F-30", "F-31", "F-35", "F-36", "F-37", "F-38", "F-39", "F-40", "F-41", "F-42"];

const built = new Map<string, UscForm>([...rawForms.map((form) => [form.code, normalize(form)] as const), ...["F-27", "F-28", "F-30"].map((code) => [code, carried(code)] as const)]);

export const uscForms2026: UscForm[] = ORDER.map((code) => {
  const form = built.get(code);
  if (!form) throw new Error(`${code} is missing from the November 2026 set.`);
  return form;
});

/** Forms of the 2025 set that the November 2026 process no longer uses. */
export const RETIRED_IN_2026 = ["F-29"];
