import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getEditableFields } from "@/lib/forms/editable";
import { findField } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import { simulateGraph, type SimulationFacts } from "@/lib/workflow/simulate";
import { validateGraph } from "@/lib/workflow/validate";
import { prisma } from "@/server/db";
import { formDefinitionFor, referenceDate, settingValue, workflowVersionFor } from "@/server/effective";
import { createProtocolForUser } from "@/server/protocols/affiliation";
import { makeUser } from "@/server/test/users";
import { uscForms } from "../../../prisma/seed/usc-rec/forms";
import { uscForms2026 } from "../../../prisma/seed/usc-rec/forms-2026-11";
import { installUscRec } from "../../../prisma/seed/usc-rec/install";
import { FEE_SCHEDULE_REF } from "../../../prisma/seed/usc-rec/install-2026-11";
import { F35_POINTS, F36_POINTS } from "../../../prisma/seed/usc-rec/points";
import { F35_POINTS_10, F36_POINTS_10 } from "../../../prisma/seed/usc-rec/points-2026-11";
import { initialSubmission, resubmission } from "../../../prisma/seed/usc-rec/workflows";
import { initialSubmission2026, PROCESS_START, resubmission2026 } from "../../../prisma/seed/usc-rec/workflows-2026-11";

const published = new Set(uscForms.map((form) => form.code));

function form(code: string) {
  const found = uscForms.find((item) => item.code === code);
  if (!found) throw new Error(`${code} is missing from the seed.`);
  return found.schema;
}

describe("USC REC seed", () => {
  it("publishes both workflow graphs", () => {
    expect(validateGraph(initialSubmission, published)).toEqual([]);
    expect(validateGraph(resubmission, published)).toEqual([]);
  });

  it("counts the printed assessment points", () => {
    const protocol = F35_POINTS.filter((point) => /^\d\.\d{2}$/.test(point.code));
    expect(protocol).toHaveLength(26);
    expect(protocol.map((point) => point.code)).toContain("1.01");
    expect(protocol.map((point) => point.code)).toContain("3.10");
    expect(F35_POINTS.some((point) => point.label === "Do you have any other concerns?")).toBe(true);

    const consent = F36_POINTS.filter((point) => /^1\.(?:0?[1-9]|1[0-8])$/.test(point.code));
    expect(consent).toHaveLength(18);
    expect(F36_POINTS.map((point) => point.code)).toEqual(expect.arrayContaining(["2", "3", "4"]));
    const contact = F36_POINTS.find((point) => point.code === "1.15");
    expect(contact?.help).toContain("REC Chair");
    expect(contact?.help).not.toContain("Panel Chair");
  });

  it("keeps page and paragraph for the proponent's submit and revise steps", () => {
    const schema = form("F-35");
    const column = findField(schema, "points")?.columns?.find((item) => item.id === "page");
    expect(column?.editableInSteps).toEqual(["proponent_submit", "proponent_revise"]);
    const draft = { status: "DRAFT" as const, data: {} };
    const onSubmit = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "proponent_submit");
    const onRevise = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "proponent_revise");
    const onReview = getEditableFields({ schema }, draft, { id: "proponent" }, ["PROPONENT"], "reviewer_assess");
    expect([...onSubmit].some((path) => path.endsWith(".page"))).toBe(true);
    expect([...onRevise].some((path) => path.endsWith(".page"))).toBe(true);
    expect([...onReview].some((path) => path.endsWith(".page"))).toBe(false);
  });

  it("shows the chair only flagged points and leaves copied comments closed", () => {
    const schema = form("F-37");
    const data = {
      praf: { p101: { comments: "Reviewer 1: Narrow the question.", recommendations: "", needs_action: true } },
      icf: {},
    };
    const editable = getEditableFields({ schema }, { status: "DRAFT", data }, { id: "chair" }, ["REC_CHAIR"], "chair_decide");
    expect([...editable].some((path) => path.includes("comments") || path.includes("recommendations"))).toBe(false);
    expect(editable.has("praf.p101.needs_action")).toBe(true);
    expect(editable.has("recommended_action")).toBe(true);
    expect(editable.has("justification")).toBe(true);
    const table = findField(schema, "praf");
    expect(table?.showRowsWhenFilled).toEqual(["needs_action"]);
  });

  it("lets a reviewer remark only on points they raised", () => {
    const schema = form("F-38");
    const data = {
      praf: {
        p101: { panel_comments: "Reviewer 1: Narrow the question.", needs_action: true },
        p102: { panel_comments: "Reviewer 2: Add the site.", needs_action: true },
      },
    };
    const allowed = { "praf.panel_remarks": ["p101"], "praf.needs_action": ["p101"] };
    const editable = getEditableFields(
      { schema },
      { status: "DRAFT", data },
      { id: "reviewer" },
      ["PRIMARY_REVIEWER"],
      "reviewer_assess",
      allowed,
    );
    expect(editable.has("praf.p101.panel_remarks")).toBe(true);
    expect(editable.has("praf.p102.panel_remarks")).toBe(false);
  });

  it("hides the needs-action flag from proponents on F-35", () => {
    const schema = form("F-35");
    const column = findField(schema, "points")?.columns?.find((item) => item.id === "needs_action");
    expect(column?.visibleToRoles).toEqual(
      expect.arrayContaining(["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "PANEL_CHAIR", "REC_CHAIR", "REC_STAFF"]),
    );
    expect(column?.visibleToRoles).not.toContain("PROPONENT");
    const recommendations = findField(schema, "points")?.columns?.find((item) => item.id === "recommendations");
    expect(recommendations?.defaultValue).toBe("No recommendations");
  });

  it("assigns determine-review to the REC Chair and leaves the reviewer list open", () => {
    const step = initialSubmission.steps.find((item) => item.key === "determine_review");
    expect(step?.assignee).toEqual({ kind: "ROLE", role: "REC_CHAIR" });
    expect(step?.assignReviewers).toEqual({
      roles: ["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"],
      min: 2,
    });
    const exempt = initialSubmission.steps.find((item) => item.key === "exemption_check");
    expect(exempt?.assignee).toEqual({ kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" });
    const returned = initialSubmission.transitions.find((item) => item.from === "exemption_check" && item.to === "return_not_qualified");
    expect(returned).toBeTruthy();
    expect(initialSubmission.steps.some((item) => item.sideTasks?.length)).toBe(false);
    expect(JSON.stringify(initialSubmission.transitions)).not.toContain("risk");
    const adviser = resubmission.transitions.find((item) => item.to === "adviser_review");
    expect(JSON.stringify(adviser?.when)).toContain("hasAdviser");
  });
});

describe("USC REC seed, November 2026 points", () => {
  it("copies every printed point of F-35 and F-36 version 10-00", () => {
    expect(F35_POINTS_10.map((point) => point.code)).toEqual([
      ...["1.01", "1.02", "1.03", "1.04", "1.05", "1.06"],
      ...["2.01", "2.02", "2.03", "2.04", "2.05", "2.06", "2.07.1", "2.07.2", "2.08", "2.09", "2.10", "2.11", "2.12", "2.13", "2.14", "2.15", "2.16", "2.17", "2.18"],
      ...["3.01", "3.02", "3.03", "3.04", "3.05", "3.06", "3.07", "3.08", "3.09", "3.10"],
      "4",
    ]);
    expect(F36_POINTS_10.filter((point) => point.code.startsWith("A."))).toHaveLength(26);
    expect(F36_POINTS_10.map((point) => point.code)).toEqual(expect.arrayContaining(["1", "1.NO", "B.01", "B.02", "C.01", "C.04", "D"]));
    expect(F36_POINTS_10.find((point) => point.code === "1.NO")?.visibleIf).toBeTruthy();
  });
});

describe("USC REC seed, November 2026 process", () => {
  const codes2026 = new Set(uscForms2026.map((form) => form.code));
  const form2026 = (code: string) => {
    const found = uscForms2026.find((item) => item.code === code);
    if (!found) throw new Error(`${code} is missing from the 2026 set.`);
    return found.schema;
  };
  const step = (graph: WorkflowGraph, key: string) => {
    const found = graph.steps.find((item) => item.key === key);
    if (!found) throw new Error(`${key} is missing.`);
    return found;
  };
  const deciding = {
    kind: "FIRST_AVAILABLE",
    rules: [
      { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" },
      { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_VICE_CHAIR" },
      { kind: "ROLE", role: "REC_CHAIR" },
    ],
  };

  it("validates both graphs against the 2026 forms, without F-29", () => {
    expect(validateGraph(initialSubmission2026, codes2026)).toEqual([]);
    expect(validateGraph(resubmission2026, codes2026)).toEqual([]);
    expect(codes2026.has("F-29")).toBe(false);
    expect(JSON.stringify([initialSubmission2026, resubmission2026])).not.toContain('"F-29"');
    expect([...codes2026]).toEqual(expect.arrayContaining(["F-40", "F-42"]));
  });

  it("prints the dates on each Word file and stores each as a new version", () => {
    const printed = Object.fromEntries(uscForms2026.map((form) => [form.code, form.effectiveDate]));
    for (const code of ["F-26", "F-31", "F-35", "F-36", "F-37", "F-38", "F-40", "F-42"]) expect(printed[code]).toBe("2027-01-01");
    for (const code of ["F-27", "F-28", "F-30", "F-39", "F-41"]) expect(printed[code]).toBe("2025-08-01");
    for (const form of uscForms2026) {
      expect(uscForms.some((old) => old.code === form.code && old.version === form.version)).toBe(false);
    }
  });

  it("asks for the protocol forms at submission and no fee receipt", () => {
    const submit = step(initialSubmission2026, "proponent_submit");
    expect(submit.forms?.map((form) => form.code)).toEqual(["F-27", "F-28", "F-30", "F-35", "F-36"]);
    expect(submit.uploads?.map((upload) => upload.kind)).toEqual(["MANUSCRIPT", "COVER_LETTER"]);
    const screening = step(initialSubmission2026, "staff_screening");
    expect(screening.feeVerifiedOutcomes).toBeUndefined();
    expect(screening.forms?.map((form) => form.code)).toEqual(["F-26"]);
    expect(screening.deadline).toMatchObject({ amount: 3, unit: "WORKING_DAYS" });
  });

  it("requires every comment and recommendation on F-35 and F-36, and the reviewer's name, date and signature", () => {
    for (const code of ["F-35", "F-36"]) {
      const schema = form2026(code);
      const columns = findField(schema, "points")?.columns ?? [];
      for (const id of ["comments", "recommendations"]) expect(columns.find((column) => column.id === id)?.required).toBe(true);
      expect(columns.find((column) => column.id === "needs_action")).toMatchObject({ type: "checkbox", label: "Needs revision" });
      for (const id of ["recommended_action", "justification", "reviewer_name", "review_date", "reviewer_signature"]) {
        expect(findField(schema, id)?.validation?.required).toBe(true);
      }
      const data = { points: { [code === "F-35" ? "p101" : "pA01"]: { assessment: "YES", comments: "", recommendations: "" } } };
      const issues = validateInstance({ schema }, data, { roles: ["REVIEWER"], stepKey: "reviewer_assess" });
      expect(issues.some((issue) => issue.path.endsWith(".comments"))).toBe(true);
    }
  });

  it("keeps the reviewers' words on F-37 and gives the chair an overriding comment", () => {
    const schema = form2026("F-37");
    const columns = findField(schema, "praf")?.columns ?? [];
    expect(columns.find((column) => column.id === "chair_comments")?.overrides).toBe("comments");
    expect(columns.find((column) => column.id === "chair_recommendations")?.overrides).toBe("recommendations");
    const data = { praf: { p101: { comments: "Reviewer 1: Narrow the question.", recommendations: "Rewrite 1.01", needs_action: true } }, icf: {} };
    const editable = getEditableFields({ schema }, { status: "DRAFT", data }, { id: "chair" }, ["PANEL_VICE_CHAIR"], "chair_review");
    expect(editable.has("praf.p101.comments")).toBe(false);
    expect(editable.has("praf.p101.chair_comments")).toBe(true);
    for (const id of ["recommended_action", "justification", "icf_action", "icf_justification"]) expect(editable.has(id)).toBe(true);
    expect(findField(schema, "prepared_by")?.signer?.role).toBe("REC_STAFF");
    expect(findField(schema, "secretary_review")).toMatchObject({ editableInSteps: ["secretary_sign_summary"], signer: { role: "PANEL_SECRETARY" } });
    expect(findField(schema, "chair_endorsement")?.fillers).toEqual(expect.arrayContaining(["PANEL_CHAIR", "PANEL_VICE_CHAIR", "REC_CHAIR"]));
  });

  it("has researchers and the adviser sign F-38, and every researcher sign the F-40 Conformé", () => {
    const actions = form2026("F-38");
    expect(findField(actions, "researcher_signature")?.signer).toEqual({ role: "PROPONENT", each: "researchers" });
    expect(findField(actions, "adviser_signature")?.signer).toEqual({ role: "ADVISER" });
    expect(findField(actions, "praf")?.columns?.find((column) => column.id === "needs_action")?.label).toBe("Still needs revision");
    expect(findField(form2026("F-40"), "conforme")).toMatchObject({ signer: { role: "PROPONENT", each: "researchers" }, editableInSteps: ["proponent_conform"] });
    expect(step(resubmission2026, "proponent_revise").forms?.map((form) => form.code)).toEqual(["F-38"]);
  });

  it("has the deciding chair fall back on a conflict, with one scientist and one non-scientist", () => {
    for (const key of ["determine_review", "exemption_recheck", "chair_review", "chair_sign_decision", "chair_sign_certificate", "exempt_sign"]) {
      expect(step(initialSubmission2026, key).assignee).toEqual(deciding);
    }
    for (const key of ["chair_decide", "chair_sign_decision", "chair_sign_certificate"]) expect(step(resubmission2026, key).assignee).toEqual(deciding);
    const determine = step(initialSubmission2026, "determine_review");
    expect(determine.forms?.map((form) => [form.code, form.required])).toEqual([
      ["F-31", true],
      ["F-41", false],
    ]);
    expect(determine.outcomes?.map((outcome) => outcome.key)).toEqual(["EXEMPT", "EXEMPT_RECOMMENDATIONS", "EXPEDITED", "FULL"]);
    expect(determine.assignReviewers?.slots?.map((slot) => [slot.key, slot.eligible?.attributes, slot.forms])).toEqual([
      ["SCIENTIST", { isScientist: true }, ["F-35"]],
      ["NON_SCIENTIST", { isScientist: false }, ["F-36"]],
    ]);
    const accept = step(initialSubmission2026, "reviewer_accept");
    expect(accept).toMatchObject({ deadline: { amount: 72, unit: "HOURS" }, onTimeout: { outcome: "ACCEPT" }, decline: { outcome: "DECLINE" } });
    expect(step(initialSubmission2026, "reviewer_assess").deadline).toMatchObject({ amount: 10, unit: "WORKING_DAYS" });
    expect(step(initialSubmission2026, "chair_review").deadline).toMatchObject({ amount: 2, unit: "WORKING_DAYS" });
  });

  it("sends and keeps the documents the November 2026 workflow lists for each decision", () => {
    expect(step(initialSubmission2026, "staff_release").release).toEqual({
      APPROVED: { send: ["F-40"], keep: ["F-39"] },
      MINOR: { send: ["F-39", { item: "F-37", showOriginal: false }] },
      MAJOR: { send: ["F-39", { item: "F-37", showOriginal: false }] },
      DISAPPROVED: { send: ["F-39", { item: "F-37", showOriginal: false }] },
    });
    const redacted = { item: "F-38", redact: ["reviewer_name", "reviewer_signature", "icf_reviewer_name", "icf_reviewer_signature"] };
    expect(step(resubmission2026, "staff_release").release).toEqual({
      APPROVED: { send: ["F-40"], keep: ["F-39", "F-38"] },
      MINOR: { send: ["F-39", redacted] },
      MAJOR: { send: ["F-39", redacted] },
      DISAPPROVED: { send: ["F-39", redacted] },
    });
    expect(step(initialSubmission2026, "staff_release_exempt").release).toEqual({ "*": { send: ["F-42"], keep: ["F-31", "F-41"] } });
    expect(step(resubmission2026, "bill_round").actions).toEqual([{ kind: "ISSUE_BILL", hook: "onEnter", params: { basis: "nthReview" } }]);
  });

  it("walks every review type in the workflow simulation without an error", () => {
    const walk = (graph: WorkflowGraph, outcomes: [string, string][], facts: SimulationFacts = {}) => {
      const run = simulateGraph(graph, outcomes.map(([stepKey, outcome]) => ({ stepKey, outcome })), new Set(), PROCESS_START, facts);
      expect(run.error).toBeNull();
      return run.stops.map((stop) => stop.stepKey);
    };
    const screened: [string, string][] = [["staff_screening", "ACCEPT"]];
    const approved: [string, string][] = [["staff_release", "RELEASE"]];
    expect(walk(initialSubmission2026, [...screened, ["determine_review", "EXEMPT"], ["exempt_payment", "VERIFIED"]]).at(-1)).toBe("end_exempted");
    const corrected = walk(initialSubmission2026, [...screened, ["determine_review", "EXEMPT_RECOMMENDATIONS"], ["exemption_recheck", "QUALIFIED"], ["exempt_payment", "VERIFIED"]]);
    expect(corrected).toEqual(expect.arrayContaining(["exempt_revise", "bill_exempt", "exempt_sign"]));
    expect(corrected.at(-1)).toBe("end_exempted");
    const expedited = walk(initialSubmission2026, [...screened, ["determine_review", "EXPEDITED"], ["chair_review", "APPROVED"], ...approved]);
    expect(expedited).not.toContain("meeting_outcome");
    expect(expedited).toEqual(expect.arrayContaining(["bill_review", "reviewer_accept", "staff_prepare_certificate", "proponent_conform"]));
    expect(expedited.at(-1)).toBe("end_approved");
    const escalated = walk(initialSubmission2026, [...screened, ["determine_review", "EXPEDITED"], ["chair_review", "DISAPPROVED"], ["meeting_outcome", "MINOR"], ...approved, ["await_revision", "RESUBMITTED"]]);
    expect(escalated).toEqual(expect.arrayContaining(["meeting_outcome", "secretary_sign_summary"]));
    expect(escalated.at(-1)).toBe("end_resubmitted");
    const full = walk(initialSubmission2026, [...screened, ["determine_review", "FULL"], ["chair_review", "APPROVED"], ["meeting_outcome", "DISAPPROVED"], ...approved]);
    expect(full.at(-1)).toBe("end_disapproved");
    const minor = walk(resubmission2026, [["staff_screening", "ACCEPT"], ["chair_decide", "APPROVED"], ...approved], { parentDecision: "MINOR", round: 2, hasAdviser: false });
    expect(minor).not.toContain("meeting_outcome");
    expect(minor.at(-1)).toBe("end_approved");
    const major = walk(resubmission2026, [["staff_screening", "ACCEPT"], ["chair_decide", "MINOR"], ["meeting_outcome", "MAJOR"], ...approved, ["await_revision", "RESUBMITTED"]], { parentDecision: "MAJOR", round: 3 });
    expect(major).toEqual(expect.arrayContaining(["adviser_review", "bill_round", "meeting_outcome"]));
    expect(major.at(-1)).toBe("end_resubmitted");
  });

  it("publishes the 2026 versions beside the 2025 ones, so a protocol started earlier keeps its versions", async () => {
    const db = prisma as unknown as PrismaClient;
    await installUscRec(db);
    const suffix = crypto.randomUUID().slice(0, 8);
    const leader = await makeUser({ email: `seed26.${suffix}@usc.edu.ph`, familyName: "Leader" });
    const email = await prisma.userEmail.findFirstOrThrow({ where: { userId: leader.id } });
    const created = await createProtocolForUser(leader.id, {
      title: `Before the seed ${suffix}`,
      researchType: "Basic",
      affiliation: { kind: "STUDENT", course: "BS Biology", yearLabel: "4th year", institution: "University of San Carlos", contactEmailId: email.id },
    });
    const started = await prisma.workflowInstance.findFirstOrThrow({ where: { protocolId: created.protocol.id }, include: { version: true } });
    // The November process starts on PROCESS_START (12 Nov 2026), so a protocol created today runs it.
    expect(started.version.effectiveFrom?.getTime()).toBe(PROCESS_START.getTime());
    // A protocol created before the start keeps the 2025 versions.
    const earlier = new Date(PROCESS_START.getTime() - 24 * 60 * 60 * 1000);
    await prisma.protocol.update({ where: { id: created.protocol.id }, data: { createdAt: earlier } });
    const counts = async () => [await prisma.workflowVersion.count(), await prisma.formDefinition.count(), await prisma.settingSchedule.count(), await prisma.feeSchedule.count()];
    const before = await counts();
    await installUscRec(db);
    expect(await counts()).toEqual(before);
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: started.id } })).versionId).toBe(started.versionId);

    const createdAt = await referenceDate(prisma, created.protocol.id);
    const later = new Date(PROCESS_START.getTime() + 60_000);
    for (const key of ["INITIAL_SUBMISSION", "RESUBMISSION"]) {
      expect((await workflowVersionFor(prisma, key, createdAt))?.effectiveFrom).toBeNull();
      expect((await workflowVersionFor(prisma, key, later))?.effectiveFrom?.getTime()).toBe(PROCESS_START.getTime());
    }
    expect((await formDefinitionFor(prisma, "F-35", createdAt))?.version).toBe("10-01");
    expect((await formDefinitionFor(prisma, "F-35", later))?.version).toBe("11-01");
    expect((await formDefinitionFor(prisma, "F-37", later))?.version).toBe("10-02");
    expect(await formDefinitionFor(prisma, "F-29", later)).toBeNull();
    expect((await formDefinitionFor(prisma, "F-29", createdAt))?.version).toBe("09-01");
    expect(await formDefinitionFor(prisma, "F-40", createdAt)).toBeNull();
    expect((await formDefinitionFor(prisma, "F-40", later))?.templateFileId).toBeTruthy();
    expect(await settingValue(prisma, "protocol.codePattern", later)).toBe("{YYYY}-{###}-{LEADER_FAMILY}{ET_AL}");
    expect(await settingValue(prisma, "protocol.versionLabel", later)).toBe("{N}/{DDMMMYYYY}");
    expect(await settingValue(prisma, "intake.scopingRules")).toHaveLength(7);
    expect(await settingValue(prisma, "meetings.schedule", later)).toMatchObject({ panels: { P1: { week: 1 }, P2: { week: 2 }, P3: { week: 3 } } });
    const schedule = await prisma.feeSchedule.findFirstOrThrow({ where: { effectiveFrom: new Date("2026-01-01T00:00:00Z"), approvedRef: FEE_SCHEDULE_REF }, include: { rates: true, rules: true } });
    expect(schedule.rates).toHaveLength(27);
    expect(schedule.rates.find((rate) => rate.clientTypeKey === "USC_SHS_UNDERGRADUATE" && rate.basis === "EXEMPT")?.amount).toBe(80_000);
    expect(schedule.rates.filter((rate) => rate.clientTypeKey === "USC_GRADUATE").map((rate) => rate.amount)).toEqual([0, 0, 0]);
    expect(schedule.rules.find((rule) => rule.key === "NTH_REVIEW")).toMatchObject({ percent: 50, fromRound: 3 });
    expect(await settingValue(prisma, "fees.distribution")).toEqual({ "Reviewer honorarium": 70, "REC operation": 20, "Administrative cost": 10 });
  }, 600_000);
});
