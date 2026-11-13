import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { fillDocx } from "@/lib/docs/fill-docx";
import { plainText, tableGrid } from "@/lib/docs/ooxml";
import { placeholderMapSchema } from "@/lib/docs/tags";
import { buildRenderModel, type SignatureRender } from "@/lib/docs/view";
import { overlayBound } from "@/lib/forms/bound";
import { fieldVisibleToRoles, columnVisibleToRoles, getEditableFields } from "@/lib/forms/editable";
import { findField, validateSchema, type FormSchema } from "@/lib/forms/schema";
import { validateInstance } from "@/lib/forms/validate";
import { intakeGaps } from "@/lib/intake/gaps";
import { budgetColumnsFor, emptyIntake, formatReference } from "@/lib/intake/model";
import { notApplicablePoints, readScopingRules } from "@/lib/intake/scoping";
import { uscForms11 } from "../../../prisma/seed/usc-rec/forms-11-01";
import { SCOPING_RULES_11 } from "../../../prisma/seed/usc-rec/scoping-11";
import { leadingNumber } from "@/lib/intake/parse";

function form(code: string): FormSchema {
  const found = uscForms11.find((item) => item.code === code);
  if (!found) throw new Error(`${code} 11-01 is missing.`);
  return found.schema;
}

function codesOf(schema: FormSchema): string[] {
  return schema.sections.flatMap((section) => section.fields.flatMap((field) => (field.type === "assessmentTable" ? (field.rows ?? []).map((row) => row.code) : [])));
}

function naFor(scoping: Record<string, unknown>) {
  const rules = readScopingRules(SCOPING_RULES_11);
  return {
    "F-35": notApplicablePoints(rules, scoping, "F-35", codesOf(form("F-35"))),
    "F-36": notApplicablePoints(rules, scoping, "F-36", codesOf(form("F-36"))),
  };
}

const BOUND = {
  "protocol.code": "2026-001-Cruz",
  "protocol.title": "Study habits of Grade 10 learners",
  "protocol.versionLabel": "1/12Nov2026",
  "protocol.researchers": ["Juan D. Cruz", "Ana M. Reyes"],
  "protocol.contactNumbers": ["09171234567"],
  "protocol.emails": ["juan.cruz@usc.edu.ph"],
  "protocol.institution": "University of San Carlos",
  "protocol.institutionAddress": "Talamban, Cebu City",
  "protocol.submissionDate": "2026-11-12",
  "protocol.researchTypeCodes": ["SOCIAL_BEHAVIORAL"],
  "protocol.researchTypeOther": "",
  "protocol.durationMonths": 6,
  "protocol.expectedParticipants": 30,
  "protocol.studySite": "Talamban campus",
  "protocol.fundingCodes": ["RESEARCHER"],
  "protocol.fundingDetail.INSTITUTION": "",
  "protocol.fundingDetail.AGENCY": "",
  "protocol.fundingDetail.OTHER": "",
  "intake.coi.kind": "NONE",
  "intake.coi.text": "",
  "intake.declarations": true,
  "intake.consents": true,
  "intake.references": { "1.01": "p. 3, line 12", "A.01": "p. 1, line 2" },
  "intake.actions": {},
  "intake.budget.PS": [],
  "intake.budget.MOOE": [
    { _rowId: "a", particular: "Supplies and materials expenses", personal: 120_000, external: null, internal: null, total: 120_000 },
    { _rowId: "f", particular: "Ethics Review Fee", personal: 160_000, external: null, internal: null, total: 160_000, _fee: true },
  ],
  "intake.budget.CAPITAL": [],
  "intake.budget.ADMIN": [],
  "intake.budget.externalSource": "",
  "team.researchers": [{ name: "Juan D. Cruz" }, { name: "Ana M. Reyes" }],
  "system.reviewType": "EXPEDITED",
  "rec.chairName": "",
} as Record<string, unknown>;

function render(code: string, bound: Record<string, unknown>, data: Record<string, unknown> = {}, signatures: SignatureRender[] = []) {
  const schema = form(code);
  const map = placeholderMapSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "templates", "11-01", "maps", `${code}.json`), "utf8")));
  const effective = overlayBound(schema, data, bound, code);
  const model = buildRenderModel({ map, data: effective, bound, signatures, schema });
  const docx = fillDocx(readFileSync(join(process.cwd(), "templates", "11-01", `${code}.docx`)), model.data, model.images);
  const xml = new PizZip(docx).file("word/document.xml")!.asText();
  return { model, xml, text: plainText(xml) };
}

describe("11-01 forms are outputs of the intake", () => {
  it("validates every 11-01 schema, and every proponent field is a read-only binding", () => {
    for (const item of uscForms11) {
      const check = validateSchema(item.schema);
      expect(check.issues, item.code).toEqual([]);
      expect(item.schema.source).toBe("intake");
      const editable = getEditableFields({ schema: item.schema }, { status: "DRAFT", data: {} }, { id: "p" }, ["PROPONENT", "PROJECT_LEADER"], "proponent_submit");
      expect([...editable], item.code).toEqual([]);
    }
  });

  it("refuses a proponent field without a binding on an intake form, and a bound column elsewhere", () => {
    const loose = { source: "intake", sections: [{ id: "s", title: "S", fields: [{ id: "duration", label: "Duration", type: "text", fillers: ["PROPONENT"] }] }] };
    expect(validateSchema(loose).ok).toBe(false);
    const column = {
      sections: [
        {
          id: "s",
          title: "S",
          fields: [
            {
              id: "points",
              label: "Points",
              type: "assessmentTable",
              fillers: ["PROPONENT"],
              rows: [{ id: "p1", code: "1", label: "One" }],
              columns: [{ id: "page", label: "Page", type: "text", fillers: ["PROPONENT"], bind: "intake.references" }],
            },
          ],
        },
      ],
    };
    expect(validateSchema(column).ok).toBe(false);
  });

  it("shows no F-27 field that is already on Details: each one reads the protocol", () => {
    const schema = form("F-27");
    for (const id of ["duration", "participants", "study_site", "research_type", "funds", "protocol_title", "institution", "address"]) {
      expect(findField(schema, id)?.bind, id).toMatch(/^protocol\./);
    }
    expect(findField(schema, "fund_amounts")).toBeUndefined();
  });

  it("follows the Details page: a new title or duration changes the F-27 preview and print with no other edit", () => {
    const before = render("F-27", BOUND);
    expect(before.text).toContain("Study habits of Grade 10 learners");
    const after = render("F-27", { ...BOUND, "protocol.title": "Reading habits of Grade 9 learners", "protocol.durationMonths": 9 });
    expect(after.text).toContain("Reading habits of Grade 9 learners");
    expect(after.model.data.duration).toBe("9");
    const preview = overlayBound(form("F-27"), {}, { ...BOUND, "protocol.durationMonths": 9 }, "F-27");
    expect(preview.duration).toBe(9);
  });

  it("prints the official F-27 wording, every researcher's signature row, and the ticks from the intake", () => {
    const out = render("F-27", BOUND);
    expect(out.text).toContain("I am aware of the ethical aspects of this research project.");
    expect(out.text).toContain("Juan D. Cruz");
    expect(out.text).toContain("Ana M. Reyes");
    expect(out.model.data.cb_declare_truth).toBe("☑");
    expect(out.model.data.cb_conflict_none).toBe("☑");
    expect(out.model.data.cb_social).toBe("☑");
    expect(out.model.data.cb_fund_personal).toBe("☑");
    expect(out.model.data.signers).toHaveLength(2);
    expect(render("F-27", { ...BOUND, "intake.declarations": false }).model.data.cb_declare_truth).toBe("☐");
  });

  it("prints F-28 with one row per researcher and its own date", () => {
    const signedAt = new Date("2026-11-12T02:00:00Z");
    const out = render("F-28", BOUND, {}, [{ fieldPath: "signatures.researchers[1]", signerName: "Ana M. Reyes", signedAt, verifyRef: "REF", image: null }]);
    const rows = out.model.data.signers as Record<string, string>[];
    expect(rows.map((row) => row.name)).toEqual(["Juan D. Cruz", "Ana M. Reyes"]);
    expect(rows[0]!.date).toBe("");
    expect(rows[1]!.date).toBe("11/12/2026");
  });

  it("prints F-30 from the budget lines: the Ethics Review Fee on its own line, totals computed", () => {
    const out = render("F-30", BOUND);
    expect(out.model.data.fee_personal).toBe("₱1,600.00");
    expect(out.model.data.fee_external).toBe("");
    expect(out.model.data.mooe_supplies_personal).toBe("₱1,200.00");
    expect(out.model.data.mooe_sub_personal).toBe("₱2,800.00");
    expect(out.model.data.grand_total).toBe("₱2,800.00");
    expect(out.model.data.grand_external).toBe("");
  });

  it("opens only the Personal column for a researcher-funded study", () => {
    expect(budgetColumnsFor(["RESEARCHER"])).toEqual(["personal"]);
    expect(budgetColumnsFor(["RESEARCHER", "AGENCY"])).toEqual(["personal", "external"]);
    expect(budgetColumnsFor(["INSTITUTION"])).toEqual(["internal"]);
  });

  it("prints F-35 with the page and line from the intake, and NA for points the scoping marks N/A", () => {
    const bound = { ...BOUND, "intake.na": naFor({ personalData: false }) };
    const out = render("F-35", bound);
    expect(out.model.data.p101_page).toBe("p. 3, line 12");
    expect(out.model.data.p302_page).toBe("NA");
    expect(out.model.data.p301_page).toBe("");
  });

  it("prints every F-36 point in the order of the November Word file", () => {
    const source = new PizZip(readFileSync(join(process.cwd(), "docs", "forms", "2026-11", "USC REC F-36 - Informed Consent Form Assessment Checklist.docx")));
    const xml = source.file("word/document.xml")!.asText();
    const official = tableGrid(xml)
      .flat()
      .map((cells) => (cells[0] ?? "").trim())
      .flatMap((text) => {
        if (text.startsWith("Is it necessary")) return ["1"];
        if (text.startsWith("If NO,")) return ["1.NO"];
        if (/^D\.\s/.test(text)) return ["D"];
        const match = text.match(/^([A-C]\.\d{2})\.?\s/);
        return match ? [match[1]!] : [];
      });
    expect(codesOf(form("F-36"))).toEqual(official);
    const printed = render("F-36", { ...BOUND, "intake.na": {} }).text.toLowerCase();
    let at = 0;
    for (const row of form("F-36").sections.flatMap((section) => section.fields).find((field) => field.id === "points")!.rows!) {
      const found = printed.toLowerCase().indexOf(row.label.slice(0, 40).toLowerCase(), at);
      expect(found, row.code).toBeGreaterThanOrEqual(0);
      at = found;
    }
  });

  it("prints F-38 with the type of review and every researcher", () => {
    const out = render("F-38", BOUND);
    expect(out.model.data.cb_type_EXPEDITED).toBe("☑");
    expect(out.model.data.cb_type_FULL).toBe("☐");
    expect((out.model.data.signers as unknown[]).length).toBe(2);
  });

  it("hides reviewer columns, the recommended action and reviewer names from proponents", () => {
    for (const code of ["F-35", "F-36"]) {
      const schema = form(code);
      const points = findField(schema, "points")!;
      const shown = (points.columns ?? []).filter((column) => columnVisibleToRoles(column, ["PROPONENT"])).map((column) => column.id);
      expect(shown, code).toEqual(["page"]);
      for (const id of ["recommended_action", "justification", "reviewer_name", "reviewer_signature"]) {
        expect(fieldVisibleToRoles(findField(schema, id)!, ["PROPONENT", "ADVISER"]), `${code} ${id}`).toBe(false);
        expect(fieldVisibleToRoles(findField(schema, id)!, ["PRIMARY_REVIEWER"]), `${code} ${id}`).toBe(true);
      }
    }
  });
});

describe("scoping rules", () => {
  it("with minors and personal data answered no, marks A.07 and 3.02 to 3.10 N/A, and keeps 2.10 (it also covers vulnerable people)", () => {
    const na = naFor({ minors: false, personalData: false });
    expect(Object.keys(na["F-36"])).toEqual(["A.07"]);
    expect(Object.keys(na["F-35"])).toEqual(["3.02", "3.03", "3.04", "3.05", "3.06", "3.07", "3.08", "3.09", "3.10"]);
    expect(na["F-35"]["2.10"]).toBeUndefined();
    expect(na["F-36"]["A.07"]).toEqual(["no minors among the participants"]);
  });

  it("marks one point per case the Word files name", () => {
    expect(Object.keys(naFor({ focusGroups: false })["F-36"])).toEqual(["A.17"]);
    expect(Object.keys(naFor({ onlineConsent: false })["F-36"])).toEqual(["A.25"]);
    expect(Object.keys(naFor({ nonEnglishIcf: false })["F-36"])).toEqual(["B.02"]);
    expect(Object.keys(naFor({ facultyInitiated: false })["F-35"])).toEqual(["2.02"]);
  });

  it("marks all of F-36 after the gateway when consent is not sought, with the proponent's reason", () => {
    const na = naFor({ consentNeeded: false, waiverReason: "Secondary analysis of anonymized records" })["F-36"];
    const codes = codesOf(form("F-36"));
    expect(Object.keys(na)).toEqual(codes.filter((code) => code !== "1" && code !== "1.NO" && code !== "D"));
    expect(na["A.01"]).toEqual(["informed consent is not sought (Secondary analysis of anonymized records)"]);
  });

  it("keeps F-36 D open for the reviewer on a waiver: it is their own field and a waiver can raise concerns", () => {
    const na = naFor({ consentNeeded: false, waiverReason: "Secondary analysis of anonymized records" });
    expect(na["F-36"]["D"]).toBeUndefined();
    const schema = form("F-36");
    const data = overlayBound(schema, {}, { ...BOUND, "intake.na": na }, "F-36");
    const points = data.points as Record<string, Record<string, unknown>>;
    const d = Object.entries(points).find(([key]) => key.toLowerCase() === "pd")?.[1];
    expect(codesOf(schema)).toContain("D");
    expect(d?._na).toBeUndefined();
    const a01 = Object.entries(points).find(([key]) => key.toLowerCase() === "pa01")?.[1];
    expect(a01?._na).toMatch(/^N\/A \(proponent: informed consent is not sought/);
  });

  it("brings the INTAKE-01 seeded rules up to date: only the consent rule changes, to leave D open", async () => {
    const { SCOPING_RULES_11_INTAKE01 } = await import("../../../prisma/seed/usc-rec/scoping-11");
    const before = SCOPING_RULES_11_INTAKE01.find((rule) => rule.id === "no-consent");
    const after = SCOPING_RULES_11.find((rule) => rule.id === "no-consent");
    expect(before?.allExcept).toEqual(["1", "1.NO"]);
    expect(after?.allExcept).toEqual(["1", "1.NO", "D"]);
    expect(SCOPING_RULES_11_INTAKE01.filter((rule) => rule.id !== "no-consent")).toEqual(SCOPING_RULES_11.filter((rule) => rule.id !== "no-consent"));
  });

  it("marks nothing for unanswered questions or yes answers", () => {
    expect(naFor({})).toEqual({ "F-35": {}, "F-36": {} });
    expect(naFor({ minors: true, personalData: true, consentNeeded: true })).toEqual({ "F-35": {}, "F-36": {} });
  });

  it("shows reviewers N/A with the reason, and lifts the reviewer requirement on that point", () => {
    const schema = form("F-35");
    const data = overlayBound(schema, {}, { ...BOUND, "intake.na": naFor({ personalData: false }) }, "F-35");
    const points = data.points as Record<string, Record<string, unknown>>;
    expect(points.p302!._na).toBe("N/A (proponent: no personal or sensitive data is collected)");
    expect(points.p302!.page).toBe("NA");
    const issues = validateInstance({ schema }, data, { roles: ["PRIMARY_REVIEWER"], stepKey: "reviewer_assess" });
    expect(issues.filter((issue) => issue.path.startsWith("points.p302."))).toEqual([]);
    expect(issues.some((issue) => issue.path.startsWith("points.p301."))).toBe(true);
  });
});

describe("intake completeness", () => {
  const study = { researchTypeCodes: ["SOCIAL_BEHAVIORAL"], durationMonths: 6, expectedParticipants: 30, studySite: "USC", fundingCodes: ["RESEARCHER"] };

  it("asks for scoping, COI, budget, references and every researcher's agreements", () => {
    const gaps = intakeGaps({
      intake: emptyIntake(),
      study,
      researchers: [{ name: "Juan D. Cruz", declarationsAt: null, consentsAt: null }],
      referencePoints: [{ form: "F-35", code: "1.01", label: "x" }],
      actionPoints: [],
    });
    expect(new Set(gaps.map((gap) => gap.section))).toEqual(new Set(["scoping", "coi", "budget", "references", "agreements"]));
  });

  it("refuses an amount in a column the sources of funds do not open", () => {
    const intake = { ...emptyIntake(), budgetLines: [{ id: "1", section: "MOOE" as const, item: "Supplies", external: 100 }] };
    const gaps = intakeGaps({ intake, study, researchers: [], referencePoints: [], actionPoints: [] });
    expect(gaps.some((gap) => gap.message.includes("external column"))).toBe(true);
  });

  it("accepts NA as a reference and formats page and line as the form prints them", () => {
    expect(formatReference({ page: "3", line: "12" })).toBe("p. 3, line 12");
    expect(formatReference("NA")).toBe("NA");
  });

  it("reads the leading number of an old free-text F-27 answer", () => {
    expect(leadingNumber("6 months")).toBe(6);
    expect(leadingNumber("approx. 1,200 respondents")).toBe(1200);
    expect(leadingNumber("30 Grade 10 students")).toBe(30);
    expect(leadingNumber("about thirty Grade 10 learners")).toBeNull();
    expect(leadingNumber("one semester")).toBeNull();
  });
});
