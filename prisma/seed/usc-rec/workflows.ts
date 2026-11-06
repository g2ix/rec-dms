import type { WorkflowGraph } from "../../../src/lib/workflow/graph";

const recChair = { kind: "ROLE" as const, role: "REC_CHAIR" as const };
const panelChair = { kind: "PANEL_ROLE_OF_PROTOCOL" as const, role: "PANEL_CHAIR" as const };
const staff = { kind: "ROLE" as const, role: "REC_STAFF" as const };
const leader = { kind: "PROTOCOL_LEADER" as const };
const adviser = { kind: "PROTOCOL_ADVISER" as const };
const secretary = { kind: "ROLE" as const, role: "MEMBER_SECRETARY" as const };

const decisions = [
  { key: "APPROVED", label: "Approved" },
  { key: "MINOR", label: "Minor modifications" },
  { key: "MAJOR", label: "Major modifications" },
  { key: "DISAPPROVED", label: "Disapproved" },
];

function eq(key: string) {
  return { "==": [{ var: "outcome" }, key] };
}

function reviewIs(value: string) {
  return { "==": [{ var: "protocol.reviewType" }, value] };
}

function decided(step: string, value: string) {
  return { "==": [{ var: `decisions.${step}` }, value] };
}

function decidedIn(step: string, values: string[]) {
  return { in: [{ var: `decisions.${step}` }, values] };
}

function fill(code: string, perAssignee = false) {
  return { code, mode: "FILL" as const, required: true, ...(perAssignee ? { perAssignee: true } : {}) };
}

function sign(code: string) {
  return { code, mode: "SIGN" as const, required: true };
}

function view(code: string) {
  return { code, mode: "VIEW" as const, required: false };
}

function days(amount: number, unit: "HOURS" | "CALENDAR_DAYS" | "WORKING_DAYS" = "CALENDAR_DAYS") {
  return { amount, unit };
}

const receiptPrefill = {
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "yesNoFromEvidence",
    formCode: "F-26",
    field: "documents",
    column: "present",
    rules: [
      { row: "p1", upload: "COVER_LETTER" },
      { row: "p2", form: "F-27" },
      { row: "p3", form: "F-28" },
      { row: "p4", form: "F-29" },
      { row: "p5", upload: "MANUSCRIPT" },
      { row: "p12", form: "F-30" },
      { row: "p13", fee: "VERIFIED" },
    ],
  },
};

const summaryHeader = {
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "summaryHeader",
    formCode: "F-37",
    fields: { reviewType: "review_type", reviewedBy: "reviewed_by", reviewDate: "review_date" },
  },
};

const summaryPrefill = [
  summaryHeader,
  {
    kind: "PREFILL" as const,
    hook: "onEnter" as const,
    params: {
      strategy: "copyReviewerColumns",
      sourceForm: "F-35",
      sourceField: "points",
      targetForm: "F-37",
      targetField: "praf",
      columns: [
        { from: "comments", to: "comments" },
        { from: "recommendations", to: "recommendations" },
      ],
    },
  },
  {
    kind: "PREFILL" as const,
    hook: "onEnter" as const,
    params: {
      strategy: "copyReviewerColumns",
      sourceForm: "F-36",
      sourceField: "points",
      targetForm: "F-37",
      targetField: "icf",
      columns: [
        { from: "comments", to: "comments" },
        { from: "recommendations", to: "recommendations" },
      ],
    },
  },
];

const decisionInstructions = {
  APPROVED: "The certification of approval is attached. Read it.",
  MINOR:
    "Revise the protocol, highlighting the changes, and submit by the deadline. Complete the Summary of Actions Taken with the actions taken, not only page numbers. Put the version number and date in the filename and the footer. The 30 working days start when the secretariat releases this notice. Failure to resubmit within 30 working days means the protocol must be reapplied. A request for extension is a formal letter to the Panel Chair within the revision period.",
  MAJOR:
    "Revise the protocol, highlighting the changes, and submit by the deadline. Complete the Summary of Actions Taken with the actions taken, not only page numbers. Put the version number and date in the filename and the footer. The 30 working days start when the secretariat releases this notice. Failure to resubmit within 30 working days means the protocol must be reapplied. A request for extension is a formal letter to the Panel Chair within the revision period.",
  DISAPPROVED: "The protocol is disapproved. The justification is copied from the Summary of Reviewers' Comments.",
};

const letterFields = {
  reviewDate: "review_date",
  reviewType: "review_type",
  submissionType: "submission_type",
  documents: "documents",
  decision: "decision",
  instructions: "instructions",
  justification: "justification",
};

const letterPrefill = {
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "decisionLetter",
    formCode: "F-39",
    decisionFromSteps: ["chair_decide", "chair_finalize"],
    justificationForms: ["F-37", "F-38"],
    justificationField: "justification",
    instructions: decisionInstructions,
    fields: letterFields,
  },
};

const deadlinePrefill = {
  kind: "PREFILL" as const,
  hook: "onExit" as const,
  params: {
    strategy: "decisionLetter",
    formCode: "F-39",
    decisionFromSteps: ["chair_decide", "chair_finalize"],
    fields: { deadline: "deadline" },
  },
};

function decisionRoutes(from: string, decisionStep: string) {
  return [
    { from, to: "proponent_conform", when: decided(decisionStep, "APPROVED"), label: "Approved" },
    { from, to: "await_revision", when: decidedIn(decisionStep, ["MINOR", "MAJOR"]), label: "Modifications" },
    { from, to: "end_disapproved", when: decided(decisionStep, "DISAPPROVED"), label: "Disapproved" },
  ];
}

const screeningOutcomes = [
  { key: "ACCEPT", label: "Accept" },
  { key: "RETURN_INCOMPLETE", label: "Return incomplete" },
];

export const initialSubmission: WorkflowGraph = {
  startStep: "proponent_submit",
  steps: [
    {
      key: "proponent_submit",
      name: "Submit the initial protocol",
      type: "TASK",
      assignee: leader,
      statusLabel: "Draft",
      forms: [fill("F-27"), fill("F-28"), fill("F-29"), fill("F-30"), fill("F-35"), fill("F-36")],
      uploads: [
        { kind: "MANUSCRIPT", required: true },
        { kind: "COVER_LETTER", required: true },
        { kind: "FEE_RECEIPT", required: true },
      ],
    },
    {
      key: "staff_screening",
      name: "Screen the submission",
      type: "TASK",
      assignee: staff,
      statusLabel: "Under Screening",
      deadline: days(2),
      forms: [fill("F-26")],
      outcomes: screeningOutcomes,
      feeVerifiedOutcomes: ["ACCEPT"],
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
      assignee: recChair,
      statusLabel: "Under Review",
      deadline: days(2),
      forms: [fill("F-31")],
      outcomes: [
        { key: "EXEMPT", label: "Exempt" },
        { key: "EXPEDITED", label: "Expedited" },
        { key: "FULL", label: "Full" },
      ],
      setFields: [{ path: "protocol.reviewType", from: "outcome" }],
      assignReviewers: { roles: ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"], min: 2 },
    },
    {
      key: "exemption_check",
      name: "Check exemption",
      type: "DECISION",
      assignee: panelChair,
      statusLabel: "Under Review",
      deadline: days(2),
      forms: [fill("F-41")],
      outcomes: [
        { key: "QUALIFIED", label: "Qualified for exemption" },
        { key: "NOT_QUALIFIED", label: "Not qualified for exemption" },
      ],
    },
    {
      key: "staff_release_exempt",
      name: "Release the exemption",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: days(5),
    },
    { key: "end_exempted", name: "Exempted", type: "END", statusLabel: "Exempted" },
    {
      key: "return_not_qualified",
      name: "Return the protocol to the project leader",
      type: "TASK",
      assignee: leader,
      statusLabel: "Returned",
      notify: { onAssigned: "exemption.not_qualified", cc: [staff] },
    },
    { key: "end_not_qualified", name: "Not qualified for exemption", type: "END", statusLabel: "Returned" },
    {
      key: "reviewer_ack",
      name: "Acknowledge the review assignment",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: days(48, "HOURS"),
    },
    {
      key: "reviewer_assess",
      name: "Assess the protocol",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: days(14),
      forms: [fill("F-35", true), fill("F-36", true)],
      notify: { onCompleted: "review.submitted", cc: [staff] },
      actions: [
        {
          kind: "PREFILL",
          hook: "onEnter",
          params: { strategy: "copySharedCells", formCode: "F-35", field: "points", columns: ["page"] },
        },
        {
          kind: "PREFILL",
          hook: "onEnter",
          params: { strategy: "copySharedCells", formCode: "F-36", field: "points", columns: ["page"] },
        },
      ],
    },
    {
      key: "chair_decide",
      name: "Decide the recommended action",
      type: "DECISION",
      assignee: recChair,
      statusLabel: "Under Review",
      deadline: days(3),
      forms: [fill("F-37")],
      outcomes: decisions,
      actions: summaryPrefill,
    },
    {
      key: "meeting_outcome",
      name: "Record the meeting date and consensus",
      type: "TASK",
      assignee: staff,
      statusLabel: "Under Review",
      outcomes: decisions,
      capture: { meetingDate: true },
    },
    {
      key: "member_secretary_endorse",
      name: "Member Secretary endorses the summary",
      type: "TASK",
      assignee: secretary,
      statusLabel: "Under Review",
      deadline: days(3),
      forms: [view("F-37")],
      actions: summaryPrefill,
    },
    {
      key: "chair_finalize",
      name: "Finalize the full-review decision",
      type: "DECISION",
      assignee: recChair,
      statusLabel: "Under Review",
      deadline: days(3),
      forms: [fill("F-37")],
      outcomes: decisions,
      actions: summaryPrefill,
    },
    {
      key: "chair_sign_decision",
      name: "Sign the notification of decision",
      type: "SIGNATURE",
      assignee: recChair,
      statusLabel: "Under Review",
      forms: [sign("F-39")],
      actions: [letterPrefill],
    },
    {
      key: "staff_release",
      name: "Release the decision",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: days(5),
      forms: [view("F-39")],
      actions: [deadlinePrefill],
    },
    {
      key: "staff_release_full",
      name: "Release the full-review decision",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: days(3),
      forms: [view("F-39")],
      actions: [deadlinePrefill],
    },
    {
      key: "proponent_conform",
      name: "Acknowledge the decision",
      type: "TASK",
      assignee: leader,
      statusLabel: "Decision Released",
    },
    { key: "end_approved", name: "Approved", type: "END", statusLabel: "Approved" },
    {
      key: "await_revision",
      name: "Await the revised protocol",
      type: "WAIT_PROPONENT",
      statusLabel: "Awaiting Revision",
      deadline: days(30, "WORKING_DAYS"),
    },
    { key: "end_lapsed", name: "Lapsed", type: "END", statusLabel: "Lapsed" },
    { key: "end_resubmitted", name: "Resubmitted", type: "END", statusLabel: "Resubmitted" },
    { key: "end_disapproved", name: "Disapproved", type: "END", statusLabel: "Disapproved" },
  ],
  transitions: [
    { from: "proponent_submit", to: "staff_screening" },
    { from: "staff_screening", to: "assign_code", when: eq("ACCEPT"), label: "Accept" },
    { from: "staff_screening", to: "proponent_submit", when: eq("RETURN_INCOMPLETE"), label: "Return", statusLabel: "Returned" },
    { from: "assign_code", to: "determine_review" },
    { from: "determine_review", to: "exemption_check", when: eq("EXEMPT") },
    { from: "determine_review", to: "reviewer_ack", when: { in: [{ var: "outcome" }, ["EXPEDITED", "FULL"]] } },
    { from: "exemption_check", to: "staff_release_exempt", when: eq("QUALIFIED") },
    { from: "exemption_check", to: "return_not_qualified", when: eq("NOT_QUALIFIED") },
    { from: "return_not_qualified", to: "end_not_qualified" },
    { from: "staff_release_exempt", to: "end_exempted" },
    { from: "reviewer_ack", to: "reviewer_assess" },
    { from: "reviewer_assess", to: "chair_decide", when: reviewIs("EXPEDITED") },
    { from: "reviewer_assess", to: "meeting_outcome", when: reviewIs("FULL") },
    { from: "chair_decide", to: "chair_sign_decision" },
    { from: "meeting_outcome", to: "member_secretary_endorse" },
    { from: "member_secretary_endorse", to: "chair_finalize" },
    { from: "chair_finalize", to: "chair_sign_decision" },
    { from: "chair_sign_decision", to: "staff_release", when: reviewIs("EXPEDITED") },
    { from: "chair_sign_decision", to: "staff_release_full", when: reviewIs("FULL") },
    ...decisionRoutes("staff_release", "chair_decide"),
    ...decisionRoutes("staff_release_full", "chair_finalize"),
    { from: "proponent_conform", to: "end_approved" },
    { from: "await_revision", to: "end_resubmitted", when: eq("RESUBMITTED") },
    { from: "await_revision", to: "end_lapsed", when: eq("OVERDUE") },
  ],
};

const actionPrefill = ["praf", "icf"].map((field) => ({
  kind: "PREFILL" as const,
  hook: "onEnter" as const,
  params: {
    strategy: "copyTableColumn",
    sourceForm: "F-37",
    sourceField: field,
    targetForm: "F-38",
    targetField: field,
    columns: [
      { from: "comments", to: "panel_comments" },
      { from: "recommendations", to: "panel_comments" },
    ],
  },
}));

export const resubmission: WorkflowGraph = {
  startStep: "proponent_revise",
  steps: [
    {
      key: "proponent_revise",
      name: "Revise the protocol",
      type: "TASK",
      assignee: leader,
      statusLabel: "Resubmitted",
      forms: [fill("F-38"), fill("F-35"), fill("F-36")],
      uploads: [{ kind: "MANUSCRIPT", required: true }],
      actions: actionPrefill,
    },
    {
      key: "adviser_review",
      name: "Adviser reviews the actions taken",
      type: "TASK",
      assignee: adviser,
      statusLabel: "Resubmitted",
      forms: [sign("F-38")],
    },
    {
      key: "staff_screening",
      name: "Screen the resubmission",
      type: "TASK",
      assignee: staff,
      statusLabel: "Under Screening",
      deadline: days(2),
      forms: [fill("F-26")],
      outcomes: screeningOutcomes,
      actions: [receiptPrefill],
    },
    {
      key: "freeze_version",
      name: "Freeze the revised version",
      type: "AUTO",
      statusLabel: "Under Screening",
      actions: [{ kind: "SNAPSHOT_VERSION", hook: "onEnter" }],
    },
    {
      key: "reviewer_assess",
      name: "Review the actions taken",
      type: "PARALLEL_TASK",
      assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine_review", source: "parent" },
      parallel: { completeWhen: "ALL" },
      statusLabel: "Under Review",
      deadline: days(14),
      forms: [fill("F-38")],
      notify: { onCompleted: "review.submitted", cc: [staff] },
    },
    {
      key: "chair_decide",
      name: "Decide on the resubmission",
      type: "DECISION",
      assignee: recChair,
      statusLabel: "Under Review",
      deadline: days(3),
      forms: [fill("F-38")],
      outcomes: decisions,
    },
    {
      key: "chair_sign_decision",
      name: "Sign the notification of decision",
      type: "SIGNATURE",
      assignee: recChair,
      statusLabel: "Under Review",
      forms: [sign("F-39")],
      actions: [letterPrefill],
    },
    {
      key: "staff_release",
      name: "Release the decision",
      type: "TASK",
      assignee: staff,
      statusLabel: "Decision Released",
      deadline: days(5),
      forms: [view("F-39")],
      actions: [deadlinePrefill],
    },
    {
      key: "proponent_conform",
      name: "Acknowledge the decision",
      type: "TASK",
      assignee: leader,
      statusLabel: "Decision Released",
    },
    { key: "end_approved", name: "Approved", type: "END", statusLabel: "Approved" },
    {
      key: "await_revision",
      name: "Await another revision",
      type: "WAIT_PROPONENT",
      statusLabel: "Awaiting Revision",
      deadline: days(30, "WORKING_DAYS"),
    },
    { key: "end_lapsed", name: "Lapsed", type: "END", statusLabel: "Lapsed" },
    { key: "end_resubmitted", name: "Resubmitted", type: "END", statusLabel: "Resubmitted" },
    { key: "end_disapproved", name: "Disapproved", type: "END", statusLabel: "Disapproved" },
  ],
  transitions: [
    { from: "proponent_revise", to: "adviser_review", when: { "==": [{ var: "protocol.hasAdviser" }, true] } },
    { from: "proponent_revise", to: "staff_screening", when: { "==": [{ var: "protocol.hasAdviser" }, false] } },
    { from: "adviser_review", to: "staff_screening" },
    { from: "staff_screening", to: "freeze_version", when: eq("ACCEPT") },
    { from: "staff_screening", to: "proponent_revise", when: eq("RETURN_INCOMPLETE"), statusLabel: "Returned" },
    { from: "freeze_version", to: "reviewer_assess" },
    { from: "reviewer_assess", to: "chair_decide" },
    { from: "chair_decide", to: "chair_sign_decision" },
    { from: "chair_sign_decision", to: "staff_release" },
    ...decisionRoutes("staff_release", "chair_decide"),
    { from: "proponent_conform", to: "end_approved" },
    { from: "await_revision", to: "end_resubmitted", when: eq("RESUBMITTED") },
    { from: "await_revision", to: "end_lapsed", when: eq("OVERDUE") },
  ],
};
