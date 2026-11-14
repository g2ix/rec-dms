import type { AssigneeRule, WorkflowGraph } from "../../../src/lib/workflow/graph";
import { withTaskNotices } from "./workflows";

/**
 * Initial submission and resubmission for the November 2026 process (docs/PROCESS-UPDATE-2026-11.md,
 * Annex J ver. 7). Every person, day count and document list here is seed data; the engine only
 * reads the graph. Both graphs are published to start on PROCESS_START, so a protocol created
 * earlier keeps the 2025 graphs in workflows.ts.
 */

/**
 * When the November 2026 process starts (Asia/Manila). The REC first gave 1 Jan 2027; on 12 Nov
 * 2026 it asked for the process to apply at once, because the system is demonstrated now and used
 * for real next year (INTAKE-01). Protocols created before this date keep the 2025 process.
 */
export const PROCESS_START = new Date("2026-11-12T00:00:00+08:00");

/** The start M14 first seeded. Scheduled rows still on it, and unused, are moved to PROCESS_START. */
export const M14_START = new Date("2027-01-01T00:00:00+08:00");

const staff = { kind: "ROLE" as const, role: "REC_STAFF" as const };
const leader = { kind: "PROTOCOL_LEADER" as const };
const adviser = { kind: "PROTOCOL_ADVISER" as const };
const secretary = { kind: "PANEL_ROLE_OF_PROTOCOL" as const, role: "PANEL_SECRETARY" as const };
/** Panel Chair; the Vice-Chair when the chair has a conflict of interest; the REC Chair when both do. */
const deciding: AssigneeRule = {
  kind: "FIRST_AVAILABLE",
  rules: [
    { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" },
    { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_VICE_CHAIR" },
    { kind: "ROLE", role: "REC_CHAIR" },
  ],
};

const decisions = [
  { key: "APPROVED", label: "Approved" },
  { key: "MINOR", label: "Minor modifications" },
  { key: "MAJOR", label: "Major modifications" },
  { key: "DISAPPROVED", label: "Disapproved" },
];

type Unit = "HOURS" | "CALENDAR_DAYS" | "WORKING_DAYS";

function eq(key: string) {
  return { "==": [{ var: "outcome" }, key] };
}

function outcomeIn(keys: string[]) {
  return { in: [{ var: "outcome" }, keys] };
}

function reviewIs(value: string) {
  return { "==": [{ var: "protocol.reviewType" }, value] };
}

function decided(step: string, value: string) {
  return { "==": [{ var: `decisions.${step}` }, value] };
}

function and(...items: unknown[]) {
  return { and: items };
}

function or(...items: unknown[]) {
  return { or: items };
}

/** A slot form is the slot reviewer's own copy, so it is also per assignee: the step checks that copy. */
function fill(code: string, required = true, slot?: string) {
  return { code, mode: "FILL" as const, required, ...(slot ? { slot, perAssignee: true } : {}) };
}

function sign(code: string) {
  return { code, mode: "SIGN" as const, required: true };
}

function view(code: string) {
  return { code, mode: "VIEW" as const, required: false };
}

function days(amount: number, unit: Unit) {
  return { amount, unit };
}

function tracked(amount: number, unit: Unit) {
  return {
    amount,
    unit,
    remindBefore: unit === "HOURS" ? [{ amount: Math.min(12, amount), unit: "HOURS" as const }] : [{ amount: 1, unit: "CALENDAR_DAYS" as const }],
    escalateTo: staff,
  };
}

const screeningOutcomes = [
  { key: "ACCEPT", label: "Accept" },
  { key: "RETURN_INCOMPLETE", label: "Return incomplete" },
];

/**
 * F-26 rows suggested from the submission, Yes or No (NA for "any other documents"); staff confirm.
 * F-27 and F-28 count only when every researcher signed. Rows 5 to 10 (ICF, assent form,
 * instrument and its permission, CVs) sit inside the manuscript PDF, so staff answer them (REC
 * answer, 12 Nov 2026). Row 12 (processing fee) and row 13 (amendments) are left to staff too.
 */
const receiptPrefill = {
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "yesNoFromEvidence",
    formCode: "F-26",
    field: "documents",
    column: "present",
    rules: [
      { row: "p1", upload: "COVER_LETTER", otherwise: "NO" },
      { row: "p2", form: "F-27", signed: true, otherwise: "NO" },
      { row: "p3", form: "F-28", signed: true, otherwise: "NO" },
      { row: "p4", upload: "MANUSCRIPT", otherwise: "NO" },
      { row: "p11", form: "F-30", otherwise: "NO" },
      { row: "p14", upload: "SUPPORTING", otherwise: "NA" },
    ],
  },
};

const summaryPrefill = [
  {
    kind: "PREFILL" as const,
    hook: "onEnter" as const,
    params: {
      strategy: "summaryHeader",
      formCode: "F-37",
      fields: { reviewType: "review_type", reviewedBy: "reviewed_by", reviewDate: "review_date" },
    },
  },
  ...(
    [
      ["F-35", "praf"],
      ["F-36", "icf"],
    ] as const
  ).map(([sourceForm, targetField]) => ({
    kind: "PREFILL" as const,
    hook: "onEnter" as const,
    params: {
      strategy: "copyReviewerColumns",
      sourceForm,
      sourceField: "points",
      targetForm: "F-37",
      targetField,
      flagColumn: "needs_action",
      // F-35 and F-36 have no blank points now, so every point is copied; flagged ones print yellow.
      onlyFlagged: false,
      columns: [
        { from: "comments", to: "comments" },
        { from: "recommendations", to: "recommendations" },
      ],
    },
  })),
];

const revisionText =
  "Revise the protocol, highlighting the changes, and submit by the deadline. Complete the Summary of Actions Taken (F-38) for the points still open, with the actions taken and the page and paragraph. Name the revised file with the version number and the date of revision, for example 2-01Jan2027. The 30 working days start when the secretariat releases this notice. Failure to resubmit within 30 working days means the protocol must be reapplied. A request for extension is a formal letter to the Panel Chair within the revision period.";

const decisionInstructions = {
  APPROVED: "The Certification of Approval is attached. Read it, sign the Conformé, and return it to the secretariat.",
  MINOR: revisionText,
  MAJOR: revisionText,
  DISAPPROVED: "The protocol is disapproved. The justification is copied from the summary of the review.",
};

function letterPrefill(decisionFromSteps: string[], justificationForms: string[]) {
  return {
    kind: "PREFILL" as const,
    hook: "onEnter" as const,
    params: {
      strategy: "decisionLetter",
      formCode: "F-39",
      decisionFromSteps,
      justificationForms,
      justificationField: "justification",
      instructions: decisionInstructions,
      fields: {
        reviewDate: "review_date",
        reviewType: "review_type",
        submissionType: "submission_type",
        documents: "documents",
        decision: "decision",
        instructions: "instructions",
        justification: "justification",
      },
    },
  };
}

function deadlinePrefill(decisionFromSteps: string[]) {
  return {
    kind: "PREFILL" as const,
    hook: "onExit" as const,
    params: { strategy: "decisionLetter", formCode: "F-39", decisionFromSteps, fields: { deadline: "deadline" } },
  };
}

function generate(signerFrom: string[]) {
  return { kind: "GENERATE_DOCUMENTS" as const, hook: "onExit" as const, params: { signerFrom } };
}

const releaseOutcome = [{ key: "RELEASE", label: "Release to the researcher" }];

/**
 * INTAKE-04: the adviser checks the protocol before REC sees it. "Return" sends it back to the
 * proponents on the same version, with comments on the sections; nothing needs signing to return.
 * "Forward" sends it to REC Staff.
 */
const adviserOutcomes = [
  { key: "FORWARD", label: "No changes needed: forward to REC" },
  { key: "RETURN", label: "Return to the proponents for changes", skipsRequirements: true },
];
/** Every return tells the proponents and the adviser, and links to the Returned for revision page. */
const returnedNotice = { notify: "protocol.returned_for_revision", notifyProponentSide: true, notifyLink: "intake" };
const adviserNotice = { onAssigned: "revision.ready_for_adviser" };
const hasAdviser = { "==": [{ var: "protocol.hasAdviser" }, true] };
const noAdviser = { "==": [{ var: "protocol.hasAdviser" }, false] };

/** Reviewer names and signatures are left out of the F-38 copy the researcher receives. */
const F38_REDACTED = {
  item: "F-38",
  redact: ["reviewer_name", "reviewer_signature", "icf_reviewer_name", "icf_reviewer_signature"],
};
/** The researcher sees the chair's overriding words where the chair wrote them (Confirm 3 default). */
const F37_SENT = { item: "F-37", showOriginal: false };

const reviewerSlots = {
  slots: [
    {
      key: "SCIENTIST",
      label: "Scientist reviewer",
      eligible: { roles: ["PANEL_MEMBER" as const, "PANEL_VICE_CHAIR" as const, "PANEL_SECRETARY" as const], attributes: { isScientist: true } },
      forms: ["F-35"],
    },
    {
      key: "NON_SCIENTIST",
      label: "Non-scientist reviewer",
      eligible: { roles: ["PANEL_MEMBER" as const, "PANEL_VICE_CHAIR" as const, "PANEL_SECRETARY" as const], attributes: { isScientist: false } },
      forms: ["F-36"],
    },
  ],
};

/** The decision of the initial review: the meeting for full review, the Panel Chair for expedited. */
function initialFinal(value: string) {
  return or(and(reviewIs("FULL"), decided("meeting_outcome", value)), and(reviewIs("EXPEDITED"), decided("chair_review", value)));
}

function initialFinalIn(values: string[]) {
  return or(...values.map(initialFinal));
}

const parentMajor = { "==": [{ var: "parent.decision" }, "MAJOR"] };

/** Annex J: a resubmission after major modifications goes to the meeting; after minor it does not. */
function resubmissionFinal(value: string) {
  return or(and(parentMajor, decided("meeting_outcome", value)), and({ "!": parentMajor }, decided("chair_decide", value)));
}

function resubmissionFinalIn(values: string[]) {
  return or(...values.map(resubmissionFinal));
}

const LETTER_STEPS = ["meeting_outcome", "chair_review", "chair_decide"];

const certificateSteps = [
  {
    key: "staff_prepare_certificate",
    name: "Prepare the Certification of Approval",
    type: "TASK" as const,
    assignee: staff,
    statusLabel: "Under Review",
    forms: [fill("F-40")],
  },
  {
    key: "chair_sign_certificate",
    name: "Sign the Certification of Approval",
    type: "SIGNATURE" as const,
    assignee: deciding,
    statusLabel: "Under Review",
    forms: [sign("F-40")],
  },
];

const closingSteps = [
  {
    key: "proponent_conform",
    name: "Sign the Conformé on the Certification of Approval",
    type: "TASK" as const,
    assignee: leader,
    statusLabel: "Decision Released",
    forms: [sign("F-40")],
  },
  {
    key: "staff_file",
    name: "File the signed Certification of Approval",
    type: "TASK" as const,
    assignee: staff,
    statusLabel: "Decision Released",
    forms: [view("F-40")],
  },
  { key: "end_approved", name: "Approved", type: "END" as const, statusLabel: "Approved" },
  {
    key: "await_revision",
    name: "Await the revised protocol",
    type: "WAIT_PROPONENT" as const,
    statusLabel: "Awaiting Revision",
    deadline: days(30, "WORKING_DAYS"),
  },
  { key: "end_lapsed", name: "Lapsed", type: "END" as const, statusLabel: "Lapsed" },
  { key: "end_resubmitted", name: "Resubmitted", type: "END" as const, statusLabel: "Resubmitted" },
  { key: "end_disapproved", name: "Disapproved", type: "END" as const, statusLabel: "Disapproved" },
];

const closingTransitions = [
  { from: "proponent_conform", to: "staff_file" },
  { from: "staff_file", to: "end_approved" },
  { from: "await_revision", to: "end_resubmitted", when: eq("RESUBMITTED") },
  { from: "await_revision", to: "end_lapsed", when: eq("OVERDUE") },
];

const initialGraph: WorkflowGraph = {
  startStep: "proponent_submit",
  steps: [
    {
      key: "proponent_submit",
      name: "Submit the initial protocol",
      type: "TASK",
      assignee: leader,
      statusLabel: "Draft",
      forms: [fill("F-27"), fill("F-28"), fill("F-30"), fill("F-35"), fill("F-36")],
      uploads: [
        { kind: "MANUSCRIPT", required: true },
        { kind: "COVER_LETTER", required: true },
      ],
    },
    {
      key: "adviser_check",
      name: "Adviser checks the protocol",
      type: "TASK",
      assignee: adviser,
      statusLabel: "With Adviser",
      outcomes: adviserOutcomes,
      notify: adviserNotice,
    },
    {
      key: "staff_screening",
      name: "Screen the submission",
      type: "TASK",
      assignee: staff,
      statusLabel: "Under Screening",
      deadline: tracked(3, "WORKING_DAYS"),
      forms: [fill("F-26")],
      outcomes: screeningOutcomes,
      actions: [receiptPrefill],
    },
    {
      key: "assign_code",
      name: "Assign the protocol code",
      type: "AUTO",
      statusLabel: "Under Screening",
      actions: [
        { kind: "ASSIGN_PROTOCOL_CODE", hook: "onEnter" },
        { kind: "SNAPSHOT_VERSION", hook: "onEnter" },
      ],
    },
    {
      key: "determine_review",
      name: "Determine the type of review",
      type: "DECISION",
      assignee: deciding,
      statusLabel: "Under Review",
      deadline: tracked(2, "WORKING_DAYS"),
      // F-41 is filled on this step only when the protocol is exempt, so it is not required for every outcome.
      forms: [fill("F-31"), fill("F-41", false)],
      outcomes: [
        { key: "EXEMPT", label: "Exempt: qualified" },
        { key: "EXEMPT_RECOMMENDATIONS", label: "Exempt: qualified with recommendations" },
        { key: "EXPEDITED", label: "Expedited" },
        { key: "FULL", label: "Full" },
      ],
      setFields: [
        { path: "protocol.reviewType", from: "value", value: "EXEMPT", when: outcomeIn(["EXEMPT", "EXEMPT_RECOMMENDATIONS"]) },
        { path: "protocol.reviewType", from: "outcome", when: outcomeIn(["EXPEDITED", "FULL"]) },
      ],
      assignReviewers: reviewerSlots,
      capture: { noteToReviewers: true, reviewDueDate: true },
    },
    {
      key: "exempt_revise",
      name: "Revise the protocol for the exemption",
      type: "TASK",
      assignee: leader,
      statusLabel: "Returned",
      forms: [view("F-41")],
      uploads: [{ kind: "MANUSCRIPT", required: true }],
      actions: [
        { kind: "REOPEN_VERSION", hook: "onEnter", params: { forms: ["F-27", "F-28", "F-30", "F-35", "F-36"] } },
        { kind: "SNAPSHOT_VERSION", hook: "onExit" },
      ],
    },
    {
      key: "exemption_recheck",
      name: "Check the revised protocol for exemption",
      type: "DECISION",
      assignee: deciding,
      statusLabel: "Under Review",
      deadline: tracked(2, "WORKING_DAYS"),
      forms: [fill("F-41")],
      outcomes: [
        { key: "QUALIFIED", label: "Qualified for exemption" },
        { key: "RECOMMENDATIONS", label: "Qualified with recommendations" },
        { key: "NOT_QUALIFIED", label: "Not qualified for exemption" },
      ],
    },
    {
      key: "bill_exempt",
      name: "Issue the exemption bill",
      type: "AUTO",
      statusLabel: "Awaiting Payment",
      actions: [{ kind: "ISSUE_BILL", hook: "onEnter", params: { basis: "reviewType" } }],
    },
    {
      key: "exempt_payment",
      name: "Verify the payment and prepare the Certification of Exemption",
      type: "TASK",
      assignee: staff,
      statusLabel: "Awaiting Payment",
      forms: [fill("F-42")],
      outcomes: [{ key: "VERIFIED", label: "Payment verified" }],
      feeVerifiedOutcomes: ["VERIFIED"],
      feeOverride: true,
    },
    {
      key: "exempt_sign",
      name: "Sign the Certification of Exemption from Review",
      type: "SIGNATURE",
      assignee: deciding,
      statusLabel: "Under Review",
      forms: [sign("F-42")],
    },
    {
      key: "staff_release_exempt",
      name: "Release the exemption",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: tracked(3, "WORKING_DAYS"),
      forms: [view("F-42")],
      release: { "*": { send: ["F-42"], keep: ["F-31", "F-41"] } },
      actions: [generate(["exempt_sign"])],
      notify: { onCompleted: "protocol.decision_released", cc: [leader] },
    },
    { key: "end_exempted", name: "Exempted", type: "END", statusLabel: "Exempted" },
    {
      key: "bill_review",
      name: "Issue the review bill",
      type: "AUTO",
      statusLabel: "Under Review",
      // The review does not wait for payment (REC answer, 10 Nov 2026). Release does.
      actions: [{ kind: "ISSUE_BILL", hook: "onEnter", params: { basis: "reviewType" } }],
    },
    {
      key: "reviewer_accept",
      name: "Accept the designation",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: tracked(72, "HOURS"),
      outcomes: [
        { key: "ACCEPT", label: "Accept" },
        { key: "DECLINE", label: "Decline (conflict of interest or another reason)", requiresComment: true },
      ],
      onTimeout: { outcome: "ACCEPT" },
      decline: { outcome: "DECLINE", redesignateBy: deciding, name: "Designate another reviewer" },
    },
    {
      key: "reviewer_assess",
      name: "Assess the protocol",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: tracked(10, "WORKING_DAYS"),
      forms: [fill("F-35", true, "SCIENTIST"), fill("F-36", true, "NON_SCIENTIST")],
      notify: { onCompleted: "review.submitted", cc: [staff] },
      actions: (["F-35", "F-36"] as const).map((formCode) => ({
        kind: "PREFILL" as const,
        hook: "onEnter" as const,
        params: { strategy: "copySharedCells", formCode, field: "points", columns: ["page"] },
      })),
    },
    {
      key: "chair_review",
      name: "Review the summary of reviewers' comments",
      type: "DECISION",
      assignee: deciding,
      statusLabel: "Under Review",
      deadline: tracked(2, "WORKING_DAYS"),
      forms: [fill("F-37")],
      outcomes: decisions,
      actions: summaryPrefill,
      // An expedited protocol the chair would disapprove goes to the full-review meeting instead.
      setFields: [{ path: "protocol.reviewType", from: "value", value: "FULL", when: and(eq("DISAPPROVED"), reviewIs("EXPEDITED")) }],
    },
    {
      key: "meeting_outcome",
      name: "Record the meeting date and decision",
      type: "DECISION",
      assignee: staff,
      statusLabel: "Awaiting Meeting",
      forms: [view("F-37")],
      outcomes: decisions,
      capture: { meetingDate: true },
    },
    {
      key: "staff_sign_summary",
      name: "Sign the summary as prepared",
      type: "SIGNATURE",
      assignee: staff,
      statusLabel: "Under Review",
      forms: [sign("F-37")],
    },
    {
      key: "secretary_sign_summary",
      name: "Panel Secretary reviews the summary",
      type: "SIGNATURE",
      assignee: secretary,
      statusLabel: "Under Review",
      forms: [sign("F-37")],
    },
    {
      key: "chair_sign_decision",
      name: "Endorse the summary and sign the notification of decision",
      type: "SIGNATURE",
      assignee: deciding,
      statusLabel: "Under Review",
      forms: [sign("F-37"), sign("F-39")],
      actions: [letterPrefill(LETTER_STEPS, ["F-37"])],
    },
    ...certificateSteps,
    {
      key: "staff_release",
      name: "Release the decision",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      // Annex J allows 3 to 7 working days; the secretariat's working figure is 5.
      deadline: tracked(5, "WORKING_DAYS"),
      forms: [view("F-39")],
      outcomes: releaseOutcome,
      feeVerifiedOutcomes: ["RELEASE"],
      feeOverride: true,
      release: {
        APPROVED: { send: ["F-40"], keep: ["F-39"] },
        MINOR: { send: ["F-39", F37_SENT] },
        MAJOR: { send: ["F-39", F37_SENT] },
        DISAPPROVED: { send: ["F-39", F37_SENT] },
      },
      actions: [deadlinePrefill(LETTER_STEPS), generate(["chair_sign_certificate", "chair_sign_decision"])],
      notify: { onCompleted: "protocol.decision_released", cc: [leader] },
    },
    ...closingSteps,
  ],
  transitions: [
    { from: "proponent_submit", to: "adviser_check", when: hasAdviser, label: "To the adviser" },
    { from: "proponent_submit", to: "staff_screening", when: noAdviser, label: "To REC" },
    { from: "adviser_check", to: "staff_screening", when: eq("FORWARD"), label: "Forward" },
    { from: "adviser_check", to: "proponent_submit", when: eq("RETURN"), label: "Return", statusLabel: "Returned", ...returnedNotice },
    { from: "staff_screening", to: "assign_code", when: eq("ACCEPT"), label: "Accept" },
    { from: "staff_screening", to: "proponent_submit", when: eq("RETURN_INCOMPLETE"), label: "Return", statusLabel: "Returned", ...returnedNotice },
    { from: "assign_code", to: "determine_review" },
    { from: "determine_review", to: "bill_exempt", when: eq("EXEMPT"), label: "Exempt" },
    { from: "determine_review", to: "exempt_revise", when: eq("EXEMPT_RECOMMENDATIONS"), label: "Exempt with recommendations", ...returnedNotice },
    { from: "determine_review", to: "bill_review", when: outcomeIn(["EXPEDITED", "FULL"]), label: "Expedited or full" },
    { from: "exempt_revise", to: "exemption_recheck" },
    { from: "exemption_recheck", to: "bill_exempt", when: eq("QUALIFIED"), label: "Qualified" },
    { from: "exemption_recheck", to: "exempt_revise", when: eq("RECOMMENDATIONS"), label: "More recommendations", ...returnedNotice },
    { from: "exemption_recheck", to: "determine_review", when: eq("NOT_QUALIFIED"), label: "Not qualified" },
    { from: "bill_exempt", to: "exempt_payment" },
    { from: "exempt_payment", to: "exempt_sign" },
    { from: "exempt_sign", to: "staff_release_exempt" },
    { from: "staff_release_exempt", to: "end_exempted" },
    { from: "bill_review", to: "reviewer_accept" },
    { from: "reviewer_accept", to: "reviewer_assess" },
    { from: "reviewer_assess", to: "chair_review" },
    // Full review (including an expedited protocol the chair would disapprove) goes to the meeting.
    { from: "chair_review", to: "meeting_outcome", when: reviewIs("FULL"), label: "Full review", priority: 1 },
    { from: "chair_review", to: "staff_sign_summary", label: "Expedited" },
    { from: "meeting_outcome", to: "staff_sign_summary" },
    { from: "staff_sign_summary", to: "secretary_sign_summary", when: reviewIs("FULL") },
    { from: "staff_sign_summary", to: "chair_sign_decision", when: reviewIs("EXPEDITED") },
    { from: "secretary_sign_summary", to: "chair_sign_decision" },
    { from: "chair_sign_decision", to: "staff_prepare_certificate", when: initialFinal("APPROVED"), label: "Approved" },
    { from: "chair_sign_decision", to: "staff_release", when: initialFinalIn(["MINOR", "MAJOR", "DISAPPROVED"]) },
    { from: "staff_prepare_certificate", to: "chair_sign_certificate" },
    { from: "chair_sign_certificate", to: "staff_release" },
    { from: "staff_release", to: "proponent_conform", when: initialFinal("APPROVED"), label: "Approved" },
    { from: "staff_release", to: "await_revision", when: initialFinalIn(["MINOR", "MAJOR"]), label: "Modifications", ...returnedNotice },
    { from: "staff_release", to: "end_disapproved", when: initialFinal("DISAPPROVED"), label: "Disapproved" },
    ...closingTransitions,
  ],
};

const actionPrefill = {
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "prepareActionSummary",
    formCode: "F-38",
    fields: ["praf", "icf"],
    flagColumn: "needs_action",
    clearColumns: ["panel_remarks", "actions_taken"],
    fallbackForm: "F-37",
  },
};

const resubmissionGraph: WorkflowGraph = {
  startStep: "proponent_revise",
  steps: [
    {
      key: "proponent_revise",
      name: "Revise the protocol and complete the summary of actions taken",
      type: "TASK",
      assignee: leader,
      statusLabel: "Resubmitted",
      forms: [fill("F-38")],
      uploads: [{ kind: "MANUSCRIPT", required: true }],
      actions: [actionPrefill],
    },
    {
      key: "adviser_review",
      name: "Adviser reviews the actions taken",
      type: "TASK",
      assignee: adviser,
      statusLabel: "Resubmitted",
      forms: [sign("F-38")],
      outcomes: adviserOutcomes,
      notify: adviserNotice,
    },
    {
      key: "staff_screening",
      name: "Screen the resubmission",
      type: "TASK",
      assignee: staff,
      statusLabel: "Under Screening",
      deadline: tracked(3, "WORKING_DAYS"),
      forms: [view("F-38")],
      outcomes: screeningOutcomes,
    },
    {
      key: "freeze_version",
      name: "Freeze the revised version",
      type: "AUTO",
      statusLabel: "Under Screening",
      actions: [{ kind: "SNAPSHOT_VERSION", hook: "onEnter" }],
    },
    {
      key: "bill_round",
      name: "Bill the third or later review",
      type: "AUTO",
      statusLabel: "Under Review",
      // NTH_REVIEW prices nothing before its first round, so the second review is not billed.
      actions: [{ kind: "ISSUE_BILL", hook: "onEnter", params: { basis: "nthReview" } }],
    },
    {
      key: "reviewer_assess",
      name: "Review the actions taken",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review", source: "parent" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: tracked(10, "WORKING_DAYS"),
      forms: [fill("F-38")],
      notify: { onCompleted: "review.submitted", cc: [staff] },
    },
    {
      key: "chair_decide",
      name: "Decide on the resubmission",
      type: "DECISION",
      assignee: deciding,
      statusLabel: "Under Review",
      deadline: tracked(2, "WORKING_DAYS"),
      forms: [view("F-38")],
      outcomes: decisions,
    },
    {
      key: "meeting_outcome",
      name: "Record the meeting date and decision",
      type: "DECISION",
      assignee: staff,
      statusLabel: "Awaiting Meeting",
      forms: [view("F-38")],
      outcomes: decisions,
      capture: { meetingDate: true },
    },
    {
      key: "chair_sign_decision",
      name: "Sign the notification of decision",
      type: "SIGNATURE",
      assignee: deciding,
      statusLabel: "Under Review",
      forms: [sign("F-39")],
      actions: [letterPrefill(LETTER_STEPS, ["F-38"])],
    },
    ...certificateSteps,
    {
      key: "staff_release",
      name: "Release the decision",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: tracked(5, "WORKING_DAYS"),
      forms: [view("F-39")],
      outcomes: releaseOutcome,
      feeVerifiedOutcomes: ["RELEASE"],
      feeOverride: true,
      release: {
        APPROVED: { send: ["F-40"], keep: ["F-39", "F-38"] },
        MINOR: { send: ["F-39", F38_REDACTED] },
        MAJOR: { send: ["F-39", F38_REDACTED] },
        DISAPPROVED: { send: ["F-39", F38_REDACTED] },
      },
      actions: [deadlinePrefill(LETTER_STEPS), generate(["chair_sign_certificate", "chair_sign_decision"])],
      notify: { onCompleted: "protocol.decision_released", cc: [leader] },
    },
    ...closingSteps.map((step) => (step.key === "await_revision" ? { ...step, name: "Await another revision" } : step)),
  ],
  transitions: [
    { from: "proponent_revise", to: "adviser_review", when: hasAdviser },
    { from: "proponent_revise", to: "staff_screening", when: noAdviser },
    { from: "adviser_review", to: "staff_screening", when: eq("FORWARD"), label: "Forward" },
    { from: "adviser_review", to: "proponent_revise", when: eq("RETURN"), label: "Return", statusLabel: "Returned", ...returnedNotice },
    { from: "staff_screening", to: "freeze_version", when: eq("ACCEPT") },
    { from: "staff_screening", to: "proponent_revise", when: eq("RETURN_INCOMPLETE"), statusLabel: "Returned", ...returnedNotice },
    { from: "freeze_version", to: "bill_round" },
    { from: "bill_round", to: "reviewer_assess" },
    { from: "reviewer_assess", to: "chair_decide" },
    { from: "chair_decide", to: "meeting_outcome", when: parentMajor, label: "After major modifications", priority: 1 },
    { from: "chair_decide", to: "chair_sign_decision", label: "After minor modifications" },
    { from: "meeting_outcome", to: "chair_sign_decision" },
    { from: "chair_sign_decision", to: "staff_prepare_certificate", when: resubmissionFinal("APPROVED"), label: "Approved" },
    { from: "chair_sign_decision", to: "staff_release", when: resubmissionFinalIn(["MINOR", "MAJOR", "DISAPPROVED"]) },
    { from: "staff_prepare_certificate", to: "chair_sign_certificate" },
    { from: "chair_sign_certificate", to: "staff_release" },
    { from: "staff_release", to: "proponent_conform", when: resubmissionFinal("APPROVED"), label: "Approved" },
    { from: "staff_release", to: "await_revision", when: resubmissionFinalIn(["MINOR", "MAJOR"]), label: "Modifications", ...returnedNotice },
    { from: "staff_release", to: "end_disapproved", when: resubmissionFinal("DISAPPROVED"), label: "Disapproved" },
    ...closingTransitions,
  ],
};

export const initialSubmission2026 = withTaskNotices(initialGraph);
export const resubmission2026 = withTaskNotices(resubmissionGraph);
