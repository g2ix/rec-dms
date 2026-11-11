import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { certificateDates } from "@/lib/certificates";
import { highlightRuns } from "@/lib/docs/fill-docx";
import { buildRenderModel, HIGHLIGHT_END, HIGHLIGHT_START } from "@/lib/docs/view";
import { distribute, quoteFee, roundLabel, scheduleOn, type ScheduleData } from "@/lib/fees/calc";
import { validateSchema } from "@/lib/forms/schema";
import { parseMemberSheet, roleFor, splitName } from "@/lib/panels/import";
import { renderProtocolCode, sequenceFromCode } from "@/lib/protocols/code";
import { versionLabel } from "@/lib/protocols/format";
import { readFirstSheet } from "@/lib/xlsx";
import { parseGraph, type WorkflowGraph } from "@/lib/workflow/graph";
import { simulateGraph } from "@/lib/workflow/simulate";
import { validateGraph } from "@/lib/workflow/validate";

const schedule2026: ScheduleData = {
  id: "s2026",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  rates: [
    { clientTypeKey: "USC_UG", basis: "EXEMPT", amount: 80_000 },
    { clientTypeKey: "USC_UG", basis: "EXPEDITED", amount: 150_000 },
    { clientTypeKey: "USC_UG", basis: "FULL", amount: 200_000 },
    { clientTypeKey: "USC_GRAD", basis: "FULL", amount: 0 },
  ],
  rules: [{ key: "NTH_REVIEW", label: "3rd to Nth review", percent: 50, fromRound: 3 }],
};

describe("protocol code tokens", () => {
  const pattern = "{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}";
  it("renders the tokens", () => {
    expect(renderProtocolCode(pattern, { year: "2026", sequence: 1, leaderFamily: "Cruz", researcherCount: 1 })).toBe("2026-001-Cruz");
    expect(renderProtocolCode(pattern, { year: "2026", sequence: 2, leaderFamily: "Santos", researcherCount: 3 })).toBe("2026-002-Santos et al");
    expect(renderProtocolCode("USC-REC-{YYYY}-{####}", { year: "2026", sequence: 7, leaderFamily: "x", researcherCount: 1 })).toBe("USC-REC-2026-0007");
  });
  it("reads the sequence back, and ignores codes from another pattern", () => {
    expect(sequenceFromCode(pattern, "2026", "2026-012-Abregana et al")).toBe(12);
    expect(sequenceFromCode(pattern, "2026", "2026-003-Cruz")).toBe(3);
    expect(sequenceFromCode(pattern, "2026", "USC-REC-2026-0004")).toBeNull();
    expect(sequenceFromCode(pattern, "2025", "2026-003-Cruz")).toBeNull();
  });
});

describe("version label format", () => {
  it("uses the pattern and keeps the old default", () => {
    const at = new Date("2026-11-11T02:00:00Z");
    expect(versionLabel(2, at, "Asia/Manila")).toBe("2/11Nov2026");
    expect(versionLabel(2, at, "Asia/Manila", "{N}-{DDMMMYYYY}")).toBe("2-11Nov2026");
    expect(versionLabel(3, at, "Asia/Manila", "no number")).toBe("3/11Nov2026");
  });
});

describe("fee calculation", () => {
  it("prices from the schedule in effect and applies the round rule", () => {
    expect(quoteFee(schedule2026, { clientTypeKey: "USC_UG", reviewType: "EXEMPT", basis: "reviewType", round: 1 })?.amount).toBe(80_000);
    expect(quoteFee(schedule2026, { clientTypeKey: "USC_UG", reviewType: "FULL", basis: "nthReview", round: 3 })?.amount).toBe(100_000);
    expect(quoteFee(schedule2026, { clientTypeKey: "USC_UG", reviewType: "FULL", basis: "nthReview", round: 2 })).toBeNull();
    expect(quoteFee(schedule2026, { clientTypeKey: "USC_GRAD", reviewType: "FULL", basis: "reviewType", round: 1 })?.amount).toBe(0);
    expect(quoteFee(schedule2026, { clientTypeKey: "NONE", reviewType: "FULL", basis: "reviewType", round: 1 })).toBeNull();
  });
  it("picks the latest schedule that has started", () => {
    const later = { ...schedule2026, id: "s2027", effectiveFrom: new Date("2027-01-01T00:00:00Z") };
    expect(scheduleOn([schedule2026, later], "2026-12-31")?.id).toBe("s2026");
    expect(scheduleOn([schedule2026, later], "2027-01-01")?.id).toBe("s2027");
    expect(scheduleOn([later], "2026-06-01")).toBeNull();
  });
  it("splits a total by shares and names the round", () => {
    expect(distribute(100_001, { A: 70, B: 20, C: 10 }).map((row) => row.amount)).toEqual([70_001, 20_000, 10_000]);
    expect(roundLabel(3)).toBe("3rd Review");
    expect(roundLabel(11)).toBe("11th Review");
  });
});

describe("certificate dates", () => {
  it("computes the approval period, progress report and continuing review dates", () => {
    expect(
      certificateDates("2027-01-15", {
        approvalPeriod: { amount: 1, unit: "YEARS" },
        progressReportAfter: { amount: 6, unit: "MONTHS" },
        continuingReviewBefore: { amount: 30, unit: "DAYS" },
      }),
    ).toEqual({ releaseDate: "2027-01-15", validUntil: "2028-01-14", progressReportDue: "2027-07-15", continuingReviewDue: "2027-12-15" });
    expect(certificateDates("2027-01-15", { approvalPeriod: null, progressReportAfter: null, continuingReviewBefore: null }).validUntil).toBeNull();
  });
});

describe("release copies", () => {
  const schema = validateSchema({
    sections: [
      {
        id: "main",
        title: "Main",
        fields: [
          {
            id: "points",
            label: "Points",
            type: "assessmentTable",
            fillers: ["REVIEWER", "PANEL_CHAIR"],
            rows: [
              { id: "r1", code: "1", label: "Aims" },
              { id: "r2", code: "2", label: "Methods" },
            ],
            columns: [
              { id: "comments", label: "Comments", type: "textarea", fillers: ["REVIEWER"] },
              { id: "chair_comment", label: "Chair", type: "textarea", fillers: ["PANEL_CHAIR"], overrides: "comments" },
              { id: "needs_action", label: "Needs action", type: "checkbox", fillers: ["REVIEWER"] },
            ],
          },
          { id: "reviewer_name", label: "Reviewer", type: "text", fillers: ["REVIEWER"] },
        ],
      },
    ],
  });
  if (!schema.ok) throw new Error("schema");
  const data = {
    points: { r1: { comments: "Reviewer text", chair_comment: "Chair text", needs_action: true }, r2: { comments: "Keep", chair_comment: "" } },
    reviewer_name: "Dr. Reviewer",
  };
  const map = {
    points: { helper: "assessmentRows" as const, path: "points", columns: ["code", "comments"], highlightIf: "needs_action" },
    reviewer: "reviewer_name",
    sig: { helper: "signature" as const, path: "reviewer_signature" },
  };
  const signatures = [{ fieldPath: "reviewer_signature", signerName: "Dr. Reviewer", signedAt: new Date(), verifyRef: "R1", image: Buffer.from("png") }];

  it("prints the override for proponents and the original otherwise, and highlights flagged points", () => {
    const staff = buildRenderModel({ map, data, bound: {}, signatures, schema: schema.schema });
    const rows = staff.data.points as Record<string, string>[];
    expect(rows[0]?.comments).toBe(`${HIGHLIGHT_START}Reviewer text${HIGHLIGHT_END}`);
    expect(rows[1]?.comments).toBe("Keep");
    const proponent = buildRenderModel({ map, data, bound: {}, signatures, schema: schema.schema, options: { showOriginal: false } });
    expect((proponent.data.points as Record<string, string>[])[0]?.comments).toBe(`${HIGHLIGHT_START}Chair text${HIGHLIGHT_END}`);
    expect((proponent.data.points as Record<string, string>[])[1]?.comments).toBe("Keep");
    expect(data.points.r1.comments).toBe("Reviewer text");
  });

  it("leaves redacted fields and signatures out of the copy only", () => {
    const full = buildRenderModel({ map, data, bound: {}, signatures, schema: schema.schema });
    expect(full.data.reviewer).toBe("Dr. Reviewer");
    expect(full.data.sig).not.toBe("");
    const redacted = buildRenderModel({ map, data, bound: {}, signatures, schema: schema.schema, options: { redact: ["reviewer_name", "reviewer_signature"] } });
    expect(redacted.data.reviewer).toBe("");
    expect(redacted.data.sig).toBe("");
    expect(redacted.images).toHaveLength(0);
    expect(data.reviewer_name).toBe("Dr. Reviewer");
  });

  it("turns highlight markers into a yellow highlight in the Word run", () => {
    const xml = `<w:p><w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr><w:t>${HIGHLIGHT_START}Flagged${HIGHLIGHT_END}</w:t></w:r><w:r><w:t>Plain</w:t></w:r></w:p>`;
    const out = highlightRuns(xml);
    expect(out).toBe('<w:p><w:r><w:rPr><w:sz w:val="22"/><w:highlight w:val="yellow"/><w:lang w:val="en-US"/></w:rPr><w:t>Flagged</w:t></w:r><w:r><w:t>Plain</w:t></w:r></w:p>');
    expect(highlightRuns(`<w:r><w:t>${HIGHLIGHT_START}A${HIGHLIGHT_END}</w:t></w:r>`)).toBe('<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>A</w:t></w:r>');
  });

  it("refuses an override of a column that is not on the table", () => {
    const bad = validateSchema({
      sections: [
        {
          id: "s",
          title: "S",
          fields: [
            {
              id: "t",
              label: "T",
              type: "assessmentTable",
              fillers: ["REVIEWER"],
              rows: [{ id: "r", code: "1", label: "R" }],
              columns: [{ id: "a", label: "A", type: "text", fillers: ["REVIEWER"], overrides: "missing" }],
            },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
  });
});

describe("panel member sheet", () => {
  function sheetBytes(rows: string[][]): Buffer {
    const zip = new PizZip();
    const cols = "ABCDEFGH";
    const body = rows
      .map((cells, index) => `<row r="${index + 1}">${cells.map((value, at) => `<c r="${cols[at]}${index + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`)
      .join("");
    zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>${body}</sheetData></worksheet>`);
    return zip.generate({ type: "nodebuffer" }) as Buffer;
  }

  it("reads panels, roles, flags and alternates, and skips rows without an email", () => {
    const bytes = sheetBytes([
      ["Panel", "No.", "Name", "Designation", "Discipline", "Affiliation", "Email"],
      ["Panel 1 (Sciences)", "1", "Ana B. Reyes, Ph.D.", "Panel Chair (Scientist)", "Biology", "Affiliate", "ana@example.edu"],
      ["", "2", "Atty. Ben Cruz", "Panel Vice-Chair (Non-scientist)", "Law", "Non-affiliate", "ben@example.org", "ben2@example.org"],
      ["", "3", "Cy Lim", "Panel Secretary (Scientist)", "Chemistry", "Affiliate", "cy@example.edu"],
      ["", "4", "Di Go", "Non-Scientist", "Ethics", "Non-Affiliate", "di@example.org"],
      ["", "", "Ed Uy, MA (alternative member)", "Scientist", "Arts", "Affiliate", ""],
      ["Panel 2 (Other)", "1", "Fe Tan", "Scientist", "Physics", "Affiliate", "fe@example.edu"],
    ]);
    const parsed = parseMemberSheet(readFirstSheet(bytes));
    expect(parsed.rows.map((row) => [row.panelCode, row.roleKey, row.attributes.isScientist])).toEqual([
      ["P1", "PANEL_CHAIR", true],
      ["P1", "PANEL_VICE_CHAIR", false],
      ["P1", "PANEL_SECRETARY", true],
      ["P1", "PANEL_MEMBER", false],
      ["P2", "PANEL_MEMBER", true],
    ]);
    expect(parsed.rows[1]?.extraEmail).toBe("ben2@example.org");
    expect(parsed.rows[1]?.attributes.affiliate).toBe(false);
    expect(parsed.skipped).toHaveLength(1);
    expect(roleFor("Scientist")).toBe("PANEL_MEMBER");
    expect(splitName("Atty. Ben Q. Cruz, LL.M., Ph.D.")).toEqual({ title: "Atty.", firstName: "Ben", middleInitial: "Q", familyName: "Cruz", credentials: ["LL.M.", "Ph.D."] });
  });
});

describe("new graph fields", () => {
  const graph: WorkflowGraph = {
    startStep: "determine",
    steps: [
      {
        key: "determine",
        name: "Type of review",
        type: "DECISION",
        assignee: { kind: "FIRST_AVAILABLE", rules: [{ kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" }, { kind: "ROLE", role: "REC_CHAIR" }] },
        outcomes: [
          { key: "EXPEDITED", label: "Expedited" },
          { key: "FULL", label: "Full" },
        ],
        setFields: [{ path: "protocol.reviewType", from: "outcome" }],
        assignReviewers: {
          slots: [
            { key: "SCIENTIST", label: "Scientist", eligible: { attributes: { isScientist: true } }, forms: [] },
            { key: "NON_SCIENTIST", label: "Non-scientist", eligible: { attributes: { isScientist: false } } },
          ],
        },
        capture: { noteToReviewers: true, reviewDueDate: true },
        actions: [{ kind: "ISSUE_BILL", hook: "onExit", params: { basis: "reviewType" } }],
      },
      {
        key: "accept",
        name: "Accept the designation",
        type: "PARALLEL_TASK",
        assignee: { kind: "ASSIGNED_IN_STEP", stepKey: "determine" },
        parallel: { completeWhen: "ALL" },
        outcomes: [
          { key: "ACCEPT", label: "Accept" },
          { key: "DECLINE", label: "Decline", requiresComment: true },
        ],
        deadline: { amount: 72, unit: "HOURS" },
        onTimeout: { outcome: "ACCEPT" },
        decline: { outcome: "DECLINE", redesignateBy: { kind: "ROLE", role: "REC_CHAIR" } },
        forms: [{ code: "SCI", mode: "VIEW", required: false, slot: "SCIENTIST" }],
      },
      {
        key: "decide",
        name: "Decide",
        type: "DECISION",
        assignee: { kind: "ROLE", role: "REC_CHAIR" },
        outcomes: [
          { key: "APPROVED", label: "Approved" },
          { key: "DISAPPROVED", label: "Disapproved" },
        ],
        setFields: [{ path: "protocol.reviewType", from: "value", value: "FULL", when: { "==": [{ var: "outcome" }, "DISAPPROVED"] } }],
        feeVerifiedOutcomes: ["APPROVED"],
        feeOverride: true,
        release: { APPROVED: { send: ["certificate:F-40"], keep: ["F-39"] }, DISAPPROVED: { send: ["F-39", { item: "F-38", redact: ["reviewer_name"] }] } },
      },
      { key: "end", name: "End", type: "END" },
    ],
    transitions: [
      { from: "determine", to: "accept" },
      { from: "accept", to: "decide" },
      { from: "decide", to: "end" },
    ],
  };

  it("parses, validates and simulates end to end with the timeout taking the default", () => {
    expect(parseGraph(graph).ok).toBe(true);
    expect(validateGraph(graph)).toEqual([]);
    const run = simulateGraph(graph, [{ stepKey: "determine", outcome: "EXPEDITED" }, { stepKey: "decide", outcome: "APPROVED" }], new Set(), new Date("2026-11-11T00:00:00Z"));
    expect(run.error).toBeNull();
    expect(run.stops.map((stop) => [stop.stepKey, stop.outcome])).toEqual([
      ["determine", "EXPEDITED"],
      ["accept", "ACCEPT"],
      ["decide", "APPROVED"],
      ["end", null],
    ]);
    expect(run.stops[0]?.notes.join(" ")).toContain("first available");
    expect(run.stops[1]?.notes.join(" ")).toContain("re-designation");
  });

  it("reports wrong references in the new fields", () => {
    const broken = structuredClone(graph);
    broken.steps[1]!.onTimeout = { outcome: "MAYBE" };
    broken.steps[1]!.forms = [{ code: "SCI", mode: "FILL", required: true, slot: "NOPE" }];
    broken.steps[2]!.setFields = [{ path: "protocol.reviewType", from: "value", value: "SLOW" }];
    broken.steps[2]!.feeVerifiedOutcomes = ["NOT_AN_OUTCOME"];
    const messages = validateGraph(broken).map((issue) => issue.message).join("\n");
    expect(messages).toContain("“MAYBE”");
    expect(messages).toContain("“NOPE”");
    expect(messages).toContain("“SLOW”");
    expect(messages).toContain("NOT_AN_OUTCOME");
    expect(parseGraph({ ...graph, steps: [{ ...graph.steps[0]!, assignReviewers: { max: 2 } }, ...graph.steps.slice(1)] }).ok).toBe(false);
  });
});
