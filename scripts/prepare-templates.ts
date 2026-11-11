import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import PizZip from "pizzip";
import { uscForms } from "../prisma/seed/usc-rec/forms";
import { F26_ITEMS, F35_POINTS, F36_POINTS } from "../prisma/seed/usc-rec/points";
import {
  appendFooterLine,
  borderedCell,
  borderedRow,
  borderedTable,
  paragraphXml,
  replaceBody,
  replaceSequential,
  replaceTextNode,
  setCellText,
  tableGrid,
  deleteTableRow,
} from "@/lib/docs/ooxml";
import { checkPlaceholderMap, tagsFromDocumentXml, type PlaceholderMap } from "@/lib/docs/tags";

const root = process.cwd();
const sourceDir = join(root, "docs", "forms", "source");
const outDir = join(root, "templates");
const mapDir = join(outDir, "maps");

const SOURCES: Record<string, string> = {
  "F-26": "F-26 Document Receipt Form.docx",
  "F-27": "F-27 Research Protocol Application Form.docx",
  "F-28": "F-28 Data Privacy Consent Form.docx",
  "F-29": "F-29 Capsule Proposal.docx",
  "F-30": "F-30 Detailed Budget Sheet.docx",
  "F-35": "F-35 Protocol Review Assessment Form.docx",
  "F-36": "F-36 Informed Consent Form Assessment Checklist.docx",
};

const F29_PATHS = [
  "intro_1",
  "intro_4",
  "intro_2",
  "intro_3",
  "intro_5",
  "definitions",
  "method_1",
  "method_2",
  "method_3",
  "method_5",
  "method_5",
  "method_4",
  "method_7",
  "method_4",
  "method_3",
  "method_6",
  "method_6",
  "method_6",
  "method_7",
  "analysis",
  "ethics",
];

function rowId(code: string): string {
  return `p${code.replaceAll(".", "")}`;
}

function load(name: string): PizZip {
  return new PizZip(readFileSync(join(sourceDir, name)));
}

function readXml(zip: PizZip, name: string): string {
  const file = zip.file(name);
  if (!file) throw new Error(`Missing ${name}`);
  return file.asText();
}

function writeXml(zip: PizZip, name: string, xml: string): void {
  zip.file(name, xml);
}

function stampFooters(zip: PizZip): void {
  for (const file of zip.file(/word\/footer\d+\.xml/)) {
    if (file.asText().includes("{signedFooter}")) continue;
    writeXml(zip, file.name, appendFooterLine(file.asText(), "{signedFooter}"));
  }
}

function fillAfterLabel(xml: string, label: string, tag: string): string {
  const tables = tableGrid(xml);
  for (let table = 0; table < tables.length; table += 1) {
    const rows = tables[table] ?? [];
    for (let row = 0; row < rows.length; row += 1) {
      const cells = rows[row] ?? [];
      const index = cells.findIndex((cell) => cell.replace(/\s+/g, " ").includes(label));
      if (index < 0) continue;
      const empty = cells.findIndex((cell, cellIndex) => cellIndex > index && cell.trim() === "");
      if (empty < 0) throw new Error(`No blank after “${label}” (${cells.join(" | ")})`);
      return setCellText(xml, table, row, empty, tag);
    }
  }
  throw new Error(`Label not found: ${label}`);
}

function fillEmptyRow(xml: string, table: number, row: number, tags: string[]): string {
  const cells = tableGrid(xml)[table]?.[row] ?? [];
  const empty = cells.map((text, index) => ({ text, index })).filter((cell) => cell.text.trim() === "");
  if (empty.length < tags.length) {
    throw new Error(`Table ${table} row ${row} has ${empty.length} blanks, needed ${tags.length}: ${cells.join(" | ")}`);
  }
  let next = xml;
  tags.forEach((tag, index) => {
    const cell = empty[index];
    if (!cell) return;
    next = setCellText(next, table, row, cell.index, tag);
  });
  return next;
}

function findRow(xml: string, includes: string): { table: number; row: number; cells: string[] } {
  const tables = tableGrid(xml);
  for (let table = 0; table < tables.length; table += 1) {
    const rows = tables[table] ?? [];
    for (let row = 0; row < rows.length; row += 1) {
      const cells = rows[row] ?? [];
      if (cells.some((cell) => cell.includes(includes))) return { table, row, cells };
    }
  }
  throw new Error(`Row not found: ${includes}`);
}

function setCellContaining(xml: string, includes: string, text: string): string {
  const found = findRow(xml, includes);
  const index = found.cells.findIndex((cell) => cell.includes(includes));
  return setCellText(xml, found.table, found.row, index, text);
}

function fillChecklist(xml: string): string {
  let next = xml;
  for (const item of F26_ITEMS) {
    const found = findRow(next, item.label);
    const id = rowId(item.code);
    next = fillEmptyRow(next, found.table, found.row, [`{cb_${id}_yes}`, `{cb_${id}_no}`, `{cb_${id}_na}`]);
  }
  return next;
}

function fillAssessment(xml: string, points: { code: string; label: string }[]): string {
  let next = xml;
  const tables = tableGrid(xml);
  for (let table = 0; table < tables.length; table += 1) {
    const rows = tables[table] ?? [];
    for (let row = 0; row < rows.length; row += 1) {
      const cells = rows[row] ?? [];
      const head = (cells[0] ?? "").replace(/\.$/, "").trim();
      const point =
        points.find((item) => item.code === head) ??
        points.find((item) => cells.some((cell) => cell.startsWith(item.label.slice(0, 48))));
      if (!point) continue;
      const empty = cells.map((text, index) => ({ text, index })).filter((cell) => cell.text.trim() === "");
      if (empty.length < 3) continue;
      const id = rowId(point.code);
      const tags =
        empty.length >= 4
          ? [`{${id}_page}`, `{${id}_assessment}`, `{${id}_comments}`, `{${id}_recommendations}`]
          : [`{${id}_page}`, `{${id}_assessment}`, `{${id}_comments} {${id}_recommendations}`];
      tags.forEach((tag, index) => {
        const cell = empty[index];
        if (!cell) return;
        next = setCellText(next, table, row, cell.index, tag);
      });
    }
  }
  return next;
}

function fillActionBoxes(xml: string): string {
  const pairs = [
    ["APPROVED", "{cb_approved}"],
    ["MINOR MODIFICATIONS REQUIRED", "{cb_minor}"],
    ["MAJOR MODIFICATIONS REQUIRED", "{cb_major}"],
    ["DISAPPROVED", "{cb_disapproved}"],
  ] as const;
  let next = xml;
  for (const [label, tag] of pairs) {
    const found = findRow(next, label);
    const box = found.cells.findIndex((cell) => cell.includes("☐") || cell.trim() === "");
    next = setCellText(next, found.table, found.row, box, tag);
  }
  return setCellContaining(next, "JUSTIFICATION:", "JUSTIFICATION: {justification}");
}

function fillUnderscoreSignature(xml: string, imageTag: string, dateTag: string): string {
  const tables = tableGrid(xml);
  let next = xml;
  let imageSet = false;
  let dateSet = false;
  for (let table = 0; table < tables.length; table += 1) {
    const rows = tables[table] ?? [];
    for (let row = 0; row < rows.length; row += 1) {
      const cells = rows[row] ?? [];
      cells.forEach((text, index) => {
        if (!/^_+$/.test(text.trim())) return;
        if (text.trim().length >= 20 && !imageSet) {
          next = setCellText(next, table, row, index, imageTag);
          imageSet = true;
        } else if (!dateSet) {
          next = setCellText(next, table, row, index, dateTag);
          dateSet = true;
        }
      });
    }
  }
  if (!imageSet) throw new Error(`No signature line for ${imageTag}`);
  return next;
}

/** Tags one official Word file. `sourceName` picks another file in docs/forms/source/ with the same layout. */
export function tagOfficial(code: string, sourceName = SOURCES[code] ?? ""): { zip: PizZip; map: PlaceholderMap } {
  const zip = load(sourceName);
  let xml = readXml(zip, "word/document.xml");
  const map: PlaceholderMap = {
    "protocol.code": { helper: "text", path: "protocol.code" },
    "protocol.title": { helper: "text", path: "protocol.title" },
    "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel" },
    "protocol.researchers": { helper: "join", path: "protocol.researchers" },
    "protocol.emails": { helper: "join", path: "protocol.emails" },
    "protocol.contactNumbers": { helper: "join", path: "protocol.contactNumbers" },
    "protocol.institution": { helper: "text", path: "protocol.institution" },
    "protocol.institutionAddress": { helper: "text", path: "protocol.institutionAddress" },
    "protocol.submissionDate": { helper: "date", path: "protocol.submissionDate" },
    signedFooter: { helper: "signedFooter" },
    rec_chair: { helper: "text", path: "rec.chairName" },
  };

  if (code === "F-26") {
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = fillAfterLabel(xml, "Contact No.", "{protocol.contactNumbers}");
    xml = fillAfterLabel(xml, "Email of", "{protocol.emails}");
    xml = fillAfterLabel(xml, "Institution:", "{protocol.institution}");
    xml = fillEmptyRow(xml, findRow(xml, "Initial Submission").table, findRow(xml, "Initial Submission").row, ["{cb_initial}", "{cb_completion}"]);
    xml = fillEmptyRow(xml, findRow(xml, "Resubmission").table, findRow(xml, "Resubmission").row, ["{cb_resubmission}", "{cb_continuing}"]);
    xml = fillEmptyRow(xml, findRow(xml, "Protocol Amendments").table, findRow(xml, "Protocol Amendments").row, ["{cb_amendment}", "{cb_termination}"]);
    const others = findRow(xml, "Others:");
    xml = setCellText(xml, others.table, others.row, 1, "{cb_other}");
    xml = xml.replace("&lt;please specify&gt;", "{submission_other}").replace("<please specify>", "{submission_other}");
    xml = fillChecklist(xml);
    const remarks = findRow(xml, "Remarks");
    xml = setCellText(xml, remarks.table, remarks.row + 1, 0, "{remarks}");
    xml = setCellContaining(xml, "Signature above printed name", "{%sig_received}");
    xml = fillAfterLabel(xml, "Date:", "{received_date}");
    Object.assign(map, {
      cb_initial: { helper: "checkbox", path: "submission_type", equals: "INITIAL", covers: ["submission_type"] },
      cb_completion: { helper: "checkbox", path: "submission_type", equals: "COMPLETION" },
      cb_resubmission: { helper: "checkbox", path: "submission_type", equals: "RESUBMISSION" },
      cb_continuing: { helper: "checkbox", path: "submission_type", equals: "CONTINUING" },
      cb_amendment: { helper: "checkbox", path: "submission_type", equals: "AMENDMENT" },
      cb_termination: { helper: "checkbox", path: "submission_type", equals: "TERMINATION" },
      cb_other: { helper: "checkbox", path: "submission_type", equals: "OTHER" },
      submission_other: { helper: "text", path: "submission_other" },
      remarks: { helper: "text", path: "remarks" },
      sig_received: { helper: "signature", path: "received_by", width: 160, height: 48 },
      received_date: { helper: "date", path: "received_date" },
    });
    for (const item of F26_ITEMS) {
      const id = rowId(item.code);
      map[`cb_${id}_yes`] = { helper: "checkbox", path: `documents.${id}.present`, equals: "YES", ...(item.code === "1" ? { covers: ["documents"] } : {}) };
      map[`cb_${id}_no`] = { helper: "checkbox", path: `documents.${id}.present`, equals: "NO" };
      map[`cb_${id}_na`] = { helper: "checkbox", path: `documents.${id}.present`, equals: "NA" };
    }
  }

  if (code === "F-27") {
    xml = fillAfterLabel(xml, "Date of Submission", "{protocol.submissionDate}");
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = fillAfterLabel(xml, "Contact No.", "{protocol.contactNumbers}");
    xml = fillAfterLabel(xml, "Email of", "{protocol.emails}");
    xml = fillAfterLabel(xml, "Institution:", "{protocol.institution}");
    xml = fillAfterLabel(xml, "Institution Address:", "{protocol.institutionAddress}");
    xml = fillEmptyRow(xml, findRow(xml, "Clinical Trial (Sponsored)").table, findRow(xml, "Clinical Trial (Sponsored)").row, ["{cb_clinical}", "{cb_social}", "{cb_stem}"]);
    xml = fillEmptyRow(xml, findRow(xml, "Researcher-initiated").table, findRow(xml, "Researcher-initiated").row, ["{cb_clinical_initiated}", "{cb_public_health}", "{cb_genetic}"]);
    xml = fillEmptyRow(xml, findRow(xml, "Health Operations").table, findRow(xml, "Health Operations").row, ["{cb_health_ops}", "{cb_biomedical}", "{cb_research_other}"]);
    xml = xml.replace("&lt;please specify&gt;", "{research_type_other}").replace("<please specify>", "{research_type_other}");
    xml = fillEmptyRow(xml, findRow(xml, "Researcher-funded").table, findRow(xml, "Researcher-funded").row, ["{cb_fund_personal}", "{cb_fund_external}"]);
    xml = fillEmptyRow(xml, findRow(xml, "Institution-funded").table, findRow(xml, "Institution-funded").row, ["{cb_fund_internal}", "{cb_fund_other}"]);
    xml = xml.replace("please specify the COI here: _______________________________________", "please specify the COI here: {conflict_details}");
    xml = replaceSequential(xml, "____________", ["{fund_agency}", "{fund_internal_name}", "{fund_other_name}"]);
    xml = fillAfterLabel(xml, "Approximate Duration", "{duration}");
    xml = fillAfterLabel(xml, "Expected number", "{participants}");
    xml = fillAfterLabel(xml, "Study Site:", "{study_site}");
    const declarations = ["declare_truth", "declare_consent", "declare_report", "declare_conduct", "declare_records", "declare_privacy"];
    for (const [index, id] of declarations.entries()) {
      const snippet = [
        "ethical aspects",
        "express consent",
        "Continuing Review Approval",
        "changes in approved",
        "adverse or unforeseen",
        "study is complete",
      ][index] ?? "";
      const found = findRow(xml, snippet);
      xml = setCellText(xml, found.table, found.row, 0, `{cb_${id}}`);
      map[`cb_${id}`] = { helper: "checkbox", path: id };
    }
    const none = findRow(xml, "no actual or potential conflict");
    xml = setCellText(xml, none.table, none.row, 0, "{cb_conflict_none}");
    const declared = findRow(xml, "either an actual or potential");
    xml = setCellText(xml, declared.table, declared.row, 0, "{cb_conflict_declared}");
    const signed = findRow(xml, "Signature of Proponents");
    xml = setCellText(xml, signed.table, signed.row, 1, "{%sig_leader}");
    xml = setCellContaining(xml, "Date:", "Date: {signed_on}");
    Object.assign(map, {
      cb_clinical: { helper: "checkbox", path: "research_type", includes: "CLINICAL", covers: ["research_type"] },
      cb_social: { helper: "checkbox", path: "research_type", includes: "SOCIAL" },
      cb_stem: { helper: "checkbox", path: "research_type", includes: "STEM" },
      cb_clinical_initiated: { helper: "checkbox", path: "research_type", includes: "CLINICAL_INITIATED" },
      cb_public_health: { helper: "checkbox", path: "research_type", includes: "PUBLIC_HEALTH" },
      cb_genetic: { helper: "checkbox", path: "research_type", includes: "GENETIC" },
      cb_health_ops: { helper: "checkbox", path: "research_type", includes: "HEALTH_OPS" },
      cb_biomedical: { helper: "checkbox", path: "research_type", includes: "BIOMEDICAL" },
      cb_research_other: { helper: "checkbox", path: "research_type", includes: "OTHER" },
      research_type_other: { helper: "text", path: "research_type_other" },
      duration: { helper: "text", path: "duration" },
      participants: { helper: "text", path: "participants" },
      study_site: { helper: "text", path: "study_site" },
      cb_fund_personal: { helper: "checkbox", path: "funds", includes: "RESEARCHER", covers: ["funds"] },
      cb_fund_external: { helper: "checkbox", path: "funds", includes: "AGENCY" },
      cb_fund_internal: { helper: "checkbox", path: "funds", includes: "INSTITUTION" },
      cb_fund_other: { helper: "checkbox", path: "funds", includes: "OTHER" },
      fund_agency: { helper: "text", path: "fund_agency", covers: ["fund_amounts"] },
      fund_internal_name: { helper: "text", path: "fund_institution" },
      fund_other_name: { helper: "text", path: "fund_other" },
      cb_conflict_none: { helper: "checkbox", path: "conflict", equals: "NONE", covers: ["conflict"] },
      cb_conflict_declared: { helper: "checkbox", path: "conflict", equals: "DECLARED" },
      conflict_details: { helper: "text", path: "conflict_details" },
      sig_leader: { helper: "signature", path: "proponent_signatures", slot: 0, width: 160, height: 48 },
      signed_on: { helper: "date", path: "proponent_signatures" },
      "protocol.code": { helper: "text", path: "protocol.code", covers: ["protocol_code"] },
      "protocol.title": { helper: "text", path: "protocol.title", covers: ["protocol_title"] },
      "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel", covers: ["version"] },
      "protocol.researchers": { helper: "join", path: "protocol.researchers", covers: ["researchers"] },
      "protocol.emails": { helper: "join", path: "protocol.emails", covers: ["emails"] },
      "protocol.contactNumbers": { helper: "join", path: "protocol.contactNumbers", covers: ["contacts"] },
      "protocol.institution": { helper: "text", path: "protocol.institution", covers: ["institution"] },
      "protocol.institutionAddress": { helper: "text", path: "protocol.institutionAddress", covers: ["address"] },
      "protocol.submissionDate": { helper: "date", path: "protocol.submissionDate", covers: ["submitted_on"] },
    });
    map.cb_declare_truth = map.cb_declare_truth ?? { helper: "checkbox", path: "declare_truth", equals: "true" };
  }

  if (code === "F-28") {
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = xml.replace(
      "I/we have fully read this form",
      "{cb_consent_collect} I/we have fully read this form",
    );
    xml = xml.replace(
      "I/we fully understand that I/we have data privacy rights",
      "{cb_consent_share} I/we fully understand that I/we have data privacy rights",
    );
    const first = findRow(xml, "1.");
    xml = setCellText(xml, first.table, first.row, 0, "1. {signer1_name}");
    xml = fillEmptyRow(xml, first.table, first.row, ["{%sig_1}", "{signer1_date}"]);
    const second = findRow(xml, "2.");
    xml = setCellText(xml, second.table, second.row, 0, "2. {signer2_name}");
    xml = fillEmptyRow(xml, second.table, second.row, ["{%sig_2}", "{signer2_date}"]);
    Object.assign(map, {
      "protocol.researchers": { helper: "join", path: "protocol.researchers", covers: ["names"] },
      cb_consent_collect: { helper: "checkbox", path: "consent_collect", equals: "true", covers: ["consent_collect", "policy"] },
      cb_consent_share: { helper: "checkbox", path: "consent_share", equals: "true" },
      signer1_name: { helper: "join", path: "protocol.researchers", slot: 0 },
      signer2_name: { helper: "join", path: "protocol.researchers", slot: 1 },
      sig_1: { helper: "signature", path: "signatures", slot: 0, width: 140, height: 42 },
      sig_2: { helper: "signature", path: "signatures", slot: 1, width: 140, height: 42 },
      signer1_date: { helper: "date", path: "signed_on", covers: ["signed_on"] },
      signer2_date: { helper: "date", path: "signed_on" },
    });
  }

  if (code === "F-29") {
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = replaceSequential(
      xml,
      "&lt;Type your entry for this section here.&gt;",
      F29_PATHS.map((_, index) => `{entry_${index + 1}}`),
    );
    F29_PATHS.forEach((path, index) => {
      map[`entry_${index + 1}`] =
        index === F29_PATHS.length - 1
          ? {
              helper: "text",
              path,
              covers: ["ethics", "method_8", "method_9", "method_10", "method_11", "method_12", "method_13"],
            }
          : { helper: "text", path };
    });
    const people = findRow(xml, "Full Name of Researcher");
    xml = fillEmptyRow(xml, people.table, people.row + 1, [
      "{#researchers}{name}",
      "{designation}",
      "{email}",
      "{%sig}",
      "{cv}{/researchers}",
    ]);
    xml = deleteTableRow(xml, people.table, people.row + 4);
    xml = deleteTableRow(xml, people.table, people.row + 3);
    xml = deleteTableRow(xml, people.table, people.row + 2);
    xml = fillAfterLabel(xml, "SIGNATURE:", "{%sig_adviser}");
    xml = fillAfterLabel(xml, "FULL NAME:", "{adviser_name}");
    xml = fillAfterLabel(xml, "DESIGNATION:", "{adviser_designation}");
    xml = fillAfterLabel(xml, "UNIT/DEPT.:", "{adviser_unit}");
    xml = fillAfterLabel(xml, "INSTITUTION:", "{adviser_institution}");
    xml = fillAfterLabel(xml, "EMAIL ADDRESS:", "{adviser_email}");
    const adviserHeading = findRow(xml, "RESEARCH SUPERVISOR");
    xml = setCellText(xml, adviserHeading.table, adviserHeading.row + 1, 1, "{adviser_appendix}");
    Object.assign(map, {
      researchers: { helper: "rows", path: "researcher_table", columns: ["name", "designation", "email", "sig", "cv"], covers: ["researcher_table"] },
      adviser_name: { helper: "text", path: "adviser_name" },
      adviser_designation: { helper: "text", path: "adviser_designation" },
      adviser_unit: { helper: "text", path: "adviser_unit" },
      adviser_institution: { helper: "text", path: "adviser_institution" },
      adviser_email: { helper: "text", path: "adviser_email" },
      adviser_appendix: { helper: "text", path: "adviser_appendix" },
      sig_adviser: { helper: "signature", path: "adviser_signature", width: 160, height: 48 },
    });
  }

  if (code === "F-30") {
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = xml.replace(
      "*External Source – outside your affiliated institution;",
      "*External Source ({external_source}) – outside your affiliated institution;",
    );
    const money = ["personal", "external", "internal", "total"] as const;
    const named: [string, string, string][] = [
      ["a. Salaries", "ps", "salaries"],
      ["b. Honoraria", "ps", "honoraria"],
      ["a. Traveling expenses", "mooe", "travel"],
      ["b. Supplies and materials expenses", "mooe", "supplies"],
      ["c. Incentive for the respondent", "mooe", "incentive"],
    ];
    for (const [label, section, match] of named) {
      const found = findRow(xml, label);
      xml = fillEmptyRow(
        xml,
        found.table,
        found.row,
        money.map((column) => `{${section}_${match}_${column}}`),
      );
      money.forEach((column) => {
        map[`${section}_${match}_${column}`] = { helper: "budgetCell", path: section, match, column };
      });
    }
    const details = ["I. Personnel Services", "a. Traveling expenses"];
    const detailTags = [
      ["ps_details", "ps", 3],
      ["mooe_details", "mooe", 1],
    ] as const;
    detailTags.forEach(([tag, section, offset], index) => {
      const anchor = findRow(xml, details[index] ?? "");
      const row = anchor.row + offset;
      let tagged = setCellText(xml, anchor.table, row, 0, `{#${tag}}{particular}`);
      tagged = setCellText(tagged, anchor.table, row, 1, "{personal}");
      tagged = setCellText(tagged, anchor.table, row, 2, "{external}");
      tagged = setCellText(tagged, anchor.table, row, 3, "{internal}");
      xml = setCellText(tagged, anchor.table, row, 4, `{total}{/${tag}}`);
      map[tag] = {
        helper: "budgetRest",
        path: section,
        columns: ["particular", "personal", "external", "internal", "total"],
        ...(index === 0 ? { covers: ["ps"] } : {}),
        ...(index === 1 ? { covers: ["mooe"] } : {}),
      };
    });
    const capital = findRow(xml, "III. Capital Outlay");
    xml = fillEmptyRow(xml, capital.table, capital.row + 1, [
      "{#capital}{particular}",
      "{personal}",
      "{external}",
      "{internal}",
      "{total}{/capital}",
    ]);
    const admin = findRow(xml, "IV. Administrative Cost");
    xml = fillEmptyRow(xml, admin.table, admin.row + 1, [
      "{#admin}{particular}",
      "{personal}",
      "{external}",
      "{internal}",
      "{total}{/admin}",
    ]);
    const ethics = findRow(xml, "Ethics Review Fee");
    xml = fillEmptyRow(xml, ethics.table, ethics.row, ["", "", "", "{ethics_fee}"]);
    const totals: [string, string, string[]?][] = [
      ["Sub-total for PS", "ps_sub", ["ps"]],
      ["Sub-total for MOOE", "mooe_sub", ["mooe"]],
      ["Sub-total for Capital Outlay", "capital_sub", ["capital"]],
      ["GRAND TOTAL", "grand", ["ps", "mooe", "capital", "admin"]],
    ];
    for (const [label, prefix, sections] of totals) {
      const found = findRow(xml, label);
      xml = fillEmptyRow(
        xml,
        found.table,
        found.row,
        money.map((column) => `{${prefix}_${column}}`),
      );
      money.forEach((column) => {
        map[`${prefix}_${column}`] = {
          helper: "budgetSum",
          path: prefix === "ps_sub" ? "ps_total" : prefix === "mooe_sub" ? "mooe_total" : prefix === "capital_sub" ? "capital_total" : "grand_total",
          sections,
          column,
          ...(prefix === "mooe_sub" ? { extraPaths: ["ethics_review_fee"] } : {}),
          ...(prefix === "grand" ? { extraPaths: ["ethics_review_fee"] } : {}),
        };
      });
    }
    const adminTotal = findRow(xml, "GRAND TOTAL");
    void adminTotal;
    map.capital = { helper: "rows", path: "capital", columns: ["particular", "personal", "external", "internal", "total"], covers: ["capital"] };
    map.admin = { helper: "rows", path: "admin", columns: ["particular", "personal", "external", "internal", "total"], covers: ["admin"] };
    map.external_source = { helper: "text", path: "external_source" };
    map.ethics_fee = { helper: "money", path: "ethics_review_fee" };
    map.admin_total_sum = { helper: "budgetSum", path: "admin_total", sections: ["admin"], column: "total" };
    map.ps_sub_total = { ...(map.ps_sub_total as object), helper: "budgetSum", path: "ps_total", sections: ["ps"], column: "total" };
    map.mooe_sub_total = { helper: "budgetSum", path: "mooe_total", sections: ["mooe"], column: "total", extraPaths: ["ethics_review_fee"] };
    map.capital_sub_total = { helper: "budgetSum", path: "capital_total", sections: ["capital"], column: "total" };
    map.grand_total = { helper: "budgetSum", path: "grand_total", sections: ["ps", "mooe", "capital", "admin"], column: "total", extraPaths: ["ethics_review_fee"] };
    const adminSub = findRow(xml, "IV. Administrative Cost");
    void adminSub;
  }

  if (code === "F-35" || code === "F-36") {
    xml = fillAfterLabel(xml, "Protocol Code:", "{protocol.code}");
    xml = fillAfterLabel(xml, "Protocol Title:", "{protocol.title}");
    xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
    xml = fillAfterLabel(xml, "Researcher(s)", "{protocol.researchers}");
    xml = xml
      .replace("&lt;mm/dd/yyyy&gt; [to be filled-up by reviewer]", "{review_date}")
      .replace("<mm/dd/yyyy> [to be filled-up by reviewer]", "{review_date}");
    xml = xml.replace("&lt; name of Panel Chair &gt;", "{rec_chair}").replace("< name of Panel Chair >", "{rec_chair}");
    xml = fillAssessment(xml, code === "F-35" ? F35_POINTS : F36_POINTS);
    xml = fillActionBoxes(xml);
    xml = fillUnderscoreSignature(xml, "{%sig_reviewer}", "{signed_on}");
    const points = code === "F-35" ? F35_POINTS : F36_POINTS;
    for (const point of points) {
      const id = rowId(point.code);
      map[`${id}_page`] = { helper: "text", path: `points.${id}.page`, ...(point === points[0] ? { covers: ["points"] } : {}) };
      map[`${id}_assessment`] = { helper: "choice", path: `points.${id}.assessment` };
      map[`${id}_comments`] = { helper: "text", path: `points.${id}.comments` };
      map[`${id}_recommendations`] = { helper: "text", path: `points.${id}.recommendations` };
    }
    Object.assign(map, {
      review_date: { helper: "date", path: "reviewer_signature" },
      cb_approved: { helper: "checkbox", path: "recommended_action", equals: "APPROVED", covers: ["recommended_action"] },
      cb_minor: { helper: "checkbox", path: "recommended_action", equals: "MINOR" },
      cb_major: { helper: "checkbox", path: "recommended_action", equals: "MAJOR" },
      cb_disapproved: { helper: "checkbox", path: "recommended_action", equals: "DISAPPROVED" },
      justification: { helper: "text", path: "justification" },
      sig_reviewer: { helper: "signature", path: "reviewer_signature", width: 170, height: 48 },
      signed_on: { helper: "date", path: "reviewer_signature" },
      ...(code === "F-35" ? { instructions: { helper: "text", path: "instructions", covers: ["instructions"] } } : {}),
    });
  }

  writeXml(zip, "word/document.xml", xml);
  stampFooters(zip);
  return { zip, map };
}

function pair(label: string, tag: string): string {
  return borderedRow([borderedCell(label, 3200), borderedCell(tag, 6160)]);
}

function headerRows(): string[] {
  return [
    pair("Protocol Code:", "{protocol.code}"),
    borderedRow([
      borderedCell("Protocol Title:", 2200),
      borderedCell("{protocol.title}", 4760),
      borderedCell("Ver.", 800),
      borderedCell("{protocol.versionLabel}", 1600),
    ]),
    pair("Researcher(s)/Proponent(s):", "{protocol.researchers}"),
  ];
}

function choiceRows(prefix: string, options: [string, string][]): string[] {
  return options.map(([value, label]) => borderedRow([borderedCell(`{cb_${prefix}_${value}}`, 700), borderedCell(label, 8660)]));
}

function reconstruct(base: PizZip, title: string, number: string, body: string): PizZip {
  const zip = new PizZip(base.generate({ type: "nodebuffer" }) as Buffer);
  const header = readXml(zip, "word/header2.xml");
  writeXml(zip, "word/header2.xml", replaceTextNode(replaceTextNode(header, "Document Receipt Form", title), "26", number));
  const document = replaceBody(readXml(zip, "word/document.xml"), `${paragraphXml(title)}${body}`);
  writeXml(zip, "word/document.xml", document);
  stampFooters(zip);
  return zip;
}

function stack(parts: Array<string | string[]>): string {
  const chunks: string[] = [];
  let rows: string[] = [];
  const flush = () => {
    if (rows.length > 0) chunks.push(borderedTable(rows));
    rows = [];
  };
  for (const part of parts.flat()) {
    if (part.startsWith("<w:tbl") || part.startsWith("<w:p")) {
      flush();
      chunks.push(part);
      continue;
    }
    rows.push(part);
  }
  flush();
  return chunks.join("");
}

function sharedMap(extra: PlaceholderMap): PlaceholderMap {
  return {
    "protocol.code": { helper: "text", path: "protocol.code" },
    "protocol.title": { helper: "text", path: "protocol.title" },
    "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel" },
    "protocol.researchers": { helper: "join", path: "protocol.researchers" },
    signedFooter: { helper: "signedFooter" },
    ...extra,
  };
}

function buildReconstructed(base: PizZip): { code: string; zip: PizZip; map: PlaceholderMap }[] {
  const forms: { code: string; zip: PizZip; map: PlaceholderMap }[] = [];

  const f31 = stack([
    ...headerRows(),
    paragraphXml("Type of Submission"),
    ...choiceRows("submission", [
      ["INITIAL", "Initial Submission"],
      ["CONTINUING", "Application for Continuing Review"],
      ["AMENDMENT", "Protocol Amendment Application"],
      ["DEVIATION", "Protocol Deviation/Violations"],
      ["COMPLETION", "Study Completion Report Form"],
      ["TERMINATION", "Early Termination Reports"],
      ["APPEAL", "Appeal"],
      ["SAE", "SAE/SUSAR Report"],
      ["OTHER", "Others"],
    ]),
    pair("Others, please specify", "{submission_other}"),
    paragraphXml("Risk to study participants"),
    ...choiceRows("risk", [
      ["NONE", "No risk"],
      ["BELOW_MINIMAL", "Below minimal risk"],
      ["MINIMAL", "Minimal risk"],
      ["GREATER", "Greater than minimal risk"],
    ]),
    paragraphXml("Does the protocol qualify for exemption from ethical review?"),
    ...choiceRows("exempt", [
      ["YES", "YES"],
      ["NO", "NO"],
    ]),
    paragraphXml("Type of review"),
    ...choiceRows("review", [
      ["EXPEDITED", "Expedited Review"],
      ["FULL", "Full Review"],
    ]),
    pair("Justification", "{justification}"),
    pair("Accomplished by", "{%sig_chair}"),
  ]);
  const submissionCovers = { covers: ["submission_type"] as string[] };
  const f31Map = sharedMap({
    submission_other: { helper: "text", path: "submission_other" },
    justification: { helper: "text", path: "justification" },
    sig_chair: { helper: "signature", path: "accomplished_by", width: 160, height: 48 },
    reviewers_note: { helper: "text", path: "reviewers_note", covers: ["reviewers_note"] },
  });
  for (const value of ["INITIAL", "CONTINUING", "AMENDMENT", "DEVIATION", "COMPLETION", "TERMINATION", "APPEAL", "SAE", "OTHER"]) {
    f31Map[`cb_submission_${value}`] = {
      helper: "checkbox",
      path: "submission_type",
      equals: value,
      ...(value === "INITIAL" ? submissionCovers : {}),
    };
  }
  for (const value of ["NONE", "BELOW_MINIMAL", "MINIMAL", "GREATER"]) {
    f31Map[`cb_risk_${value}`] = { helper: "checkbox", path: "risk", equals: value, ...(value === "NONE" ? { covers: ["risk"] } : {}) };
  }
  f31Map.cb_exempt_YES = { helper: "checkbox", path: "exempt", equals: "YES", covers: ["exempt"] };
  f31Map.cb_exempt_NO = { helper: "checkbox", path: "exempt", equals: "NO" };
  f31Map.cb_review_EXPEDITED = { helper: "checkbox", path: "review_type", equals: "EXPEDITED", covers: ["review_type"] };
  f31Map.cb_review_FULL = { helper: "checkbox", path: "review_type", equals: "FULL" };
  forms.push({
    code: "F-31",
    zip: reconstruct(base, "Form on Determining the Type of Review", "31", f31),
    map: f31Map,
  });

  const loopTable = (tag: string, headers: string[], cells: string[]) =>
    borderedTable([
      borderedRow(headers.map((header) => borderedCell(header, Math.floor(9360 / headers.length)))),
      borderedRow(cells.map((cell) => borderedCell(cell, Math.floor(9360 / cells.length)))),
    ]);

  const f37 = stack([
    borderedTable(headerRows()),
    pair("Type of review", "{review_type}"),
    pair("Reviewed by", "{reviewed_by}"),
    pair("Date", "{review_date}"),
    paragraphXml("Protocol Review Assessment Form"),
    loopTable("praf", ["Point", "Comments", "Recommendations"], ["{#praf}{code} {label}", "{comments}", "{recommendations}{/praf}"]),
    paragraphXml("ICF Assessment Checklist"),
    loopTable("icf", ["Point", "Comments", "Recommendations"], ["{#icf}{code} {label}", "{comments}", "{recommendations}{/icf}"]),
    paragraphXml("Recommended action"),
    ...choiceRows("action", [
      ["APPROVED", "APPROVED"],
      ["MINOR", "MINOR MODIFICATIONS REQUIRED"],
      ["MAJOR", "MAJOR MODIFICATIONS REQUIRED"],
      ["DISAPPROVED", "DISAPPROVED"],
    ]),
    pair("Justification", "{justification}"),
  ]);
  forms.push({
    code: "F-37",
    zip: reconstruct(base, "Summary of Reviewers' Comments", "37", f37),
    map: sharedMap({
      review_type: { helper: "text", path: "review_type" },
      reviewed_by: { helper: "text", path: "reviewed_by" },
      review_date: { helper: "date", path: "review_date" },
      praf: {
        helper: "assessmentRows",
        path: "praf",
        columns: ["code", "label", "comments", "recommendations"],
        onlyFilled: ["needs_action"],
        covers: ["praf", "copied_note"],
      },
      icf: {
        helper: "assessmentRows",
        path: "icf",
        columns: ["code", "label", "comments", "recommendations"],
        onlyFilled: ["needs_action"],
      },
      cb_action_APPROVED: { helper: "checkbox", path: "recommended_action", equals: "APPROVED", covers: ["recommended_action"] },
      cb_action_MINOR: { helper: "checkbox", path: "recommended_action", equals: "MINOR" },
      cb_action_MAJOR: { helper: "checkbox", path: "recommended_action", equals: "MAJOR" },
      cb_action_DISAPPROVED: { helper: "checkbox", path: "recommended_action", equals: "DISAPPROVED" },
      justification: { helper: "text", path: "justification" },
    }),
  });

  const f38 = stack([
    borderedTable(headerRows()),
    paragraphXml("Protocol review points"),
    loopTable(
      "praf",
      ["Point", "Page and paragraph", "Panel comments", "Actions taken", "Panel remarks"],
      ["{#praf}{code} {label}", "{page}", "{panel_comments}", "{actions_taken}", "{panel_remarks}{/praf}"],
    ),
    paragraphXml("ICF points"),
    loopTable(
      "icf",
      ["Point", "Page and paragraph", "Panel comments", "Actions taken", "Panel remarks"],
      ["{#icf}{code} {label}", "{page}", "{panel_comments}", "{actions_taken}", "{panel_remarks}{/icf}"],
    ),
    paragraphXml("Recommended action"),
    ...choiceRows("action", [
      ["APPROVED", "APPROVED"],
      ["MINOR", "MINOR MODIFICATIONS REQUIRED"],
      ["MAJOR", "MAJOR MODIFICATIONS REQUIRED"],
      ["DISAPPROVED", "DISAPPROVED"],
    ]),
    pair("Justification", "{justification}"),
    pair("Accomplished by Researcher", "{%sig_researcher}"),
    pair("Reviewed by Research Adviser", "{%sig_adviser}"),
  ]);
  forms.push({
    code: "F-38",
    zip: reconstruct(base, "Summary of Actions Taken", "38", f38),
    map: sharedMap({
      praf: {
        helper: "assessmentRows",
        path: "praf",
        columns: ["code", "label", "page", "panel_comments", "actions_taken", "panel_remarks"],
        onlyFilled: ["needs_action"],
      },
      icf: {
        helper: "assessmentRows",
        path: "icf",
        columns: ["code", "label", "page", "panel_comments", "actions_taken", "panel_remarks"],
        onlyFilled: ["needs_action"],
      },
      cb_action_APPROVED: { helper: "checkbox", path: "recommended_action", equals: "APPROVED", covers: ["recommended_action"] },
      cb_action_MINOR: { helper: "checkbox", path: "recommended_action", equals: "MINOR" },
      cb_action_MAJOR: { helper: "checkbox", path: "recommended_action", equals: "MAJOR" },
      cb_action_DISAPPROVED: { helper: "checkbox", path: "recommended_action", equals: "DISAPPROVED" },
      justification: { helper: "text", path: "justification" },
      sig_researcher: { helper: "signature", path: "researcher_signature", width: 160, height: 48 },
      sig_adviser: { helper: "signature", path: "adviser_signature", width: 160, height: 48 },
    }),
  });

  const f39 = stack([
    borderedTable([
      ...headerRows(),
      pair("Date of review", "{review_date}"),
      pair("Type of review", "{review_type}"),
      pair("Type of submission", "{submission_type}"),
      pair("Documents under review", "{documents}"),
    ]),
    paragraphXml("Decision"),
    ...choiceRows("decision", [
      ["APPROVED", "Approved"],
      ["MINOR", "Minor modifications required"],
      ["MAJOR", "Major modifications required"],
      ["DISAPPROVED", "Disapproved"],
      ["EXEMPTED", "Exempted"],
    ]),
    pair("Instructions", "{instructions}"),
    pair("Submission deadline", "{deadline}"),
    pair("Justification, if disapproved", "{justification}"),
    pair("Signature over printed name, USC Panel Chair", "{%sig_chair}"),
  ]);
  forms.push({
    code: "F-39",
    zip: reconstruct(base, "Notification of REC Decision", "39", f39),
    map: sharedMap({
      review_date: { helper: "date", path: "review_date" },
      review_type: { helper: "text", path: "review_type" },
      submission_type: { helper: "text", path: "submission_type" },
      documents: { helper: "text", path: "documents" },
      cb_decision_APPROVED: { helper: "checkbox", path: "decision", equals: "APPROVED", covers: ["decision"] },
      cb_decision_MINOR: { helper: "checkbox", path: "decision", equals: "MINOR" },
      cb_decision_MAJOR: { helper: "checkbox", path: "decision", equals: "MAJOR" },
      cb_decision_DISAPPROVED: { helper: "checkbox", path: "decision", equals: "DISAPPROVED" },
      cb_decision_EXEMPTED: { helper: "checkbox", path: "decision", equals: "EXEMPTED" },
      instructions: { helper: "text", path: "instructions" },
      deadline: { helper: "date", path: "deadline" },
      justification: { helper: "text", path: "justification" },
      sig_chair: { helper: "signature", path: "chair_signature", width: 160, height: 48 },
    }),
  });

  const f41 = stack([
    borderedTable(headerRows()),
    paragraphXml("Criteria"),
    loopTable("criteria", ["Item", "YES / NO", "Comments"], ["{#criteria}{code} {label}", "{answer}", "{comments}{/criteria}"]),
    paragraphXml("Recommended action"),
    ...choiceRows("action", [
      ["QUALIFIED", "QUALIFIED FOR EXEMPTION"],
      ["NOT_QUALIFIED", "NOT QUALIFIED FOR EXEMPTION"],
    ]),
    pair("Summary of recommendations", "{summary}"),
    pair("Justification", "{justification}"),
    pair("Signature of Panel Chair", "{%sig_chair}"),
  ]);
  forms.push({
    code: "F-41",
    zip: reconstruct(base, "Checklist for Exemption from Ethical Review", "41", f41),
    map: sharedMap({
      criteria: { helper: "assessmentRows", path: "criteria", columns: ["code", "label", "answer", "comments"] },
      cb_action_QUALIFIED: { helper: "checkbox", path: "recommended_action", equals: "QUALIFIED", covers: ["recommended_action"] },
      cb_action_NOT_QUALIFIED: { helper: "checkbox", path: "recommended_action", equals: "NOT_QUALIFIED" },
      summary: { helper: "text", path: "summary" },
      justification: { helper: "text", path: "justification" },
      sig_chair: { helper: "signature", path: "chair_signature", width: 160, height: 48 },
    }),
  });

  return forms;
}

function publish(code: string, zip: PizZip, map: PlaceholderMap): void {
  const form = uscForms.find((item) => item.code === code);
  if (!form) throw new Error(`No schema for ${code}`);
  const parts = zip.file(/word\/(document|footer\d+)\.xml/).map((file) => ({ name: file.name, xml: file.asText() }));
  const check = checkPlaceholderMap({ tags: tagsFromDocumentXml(parts), map, schema: form.schema });
  if (check.unmappedTags.length || check.unmappedFields.length) {
    throw new Error(
      `${code} unmapped tags: ${check.unmappedTags.join(", ") || "none"}\nunmapped fields: ${check.unmappedFields.join(", ") || "none"}`,
    );
  }
  mkdirSync(dirname(join(outDir, `${code}.docx`)), { recursive: true });
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(join(outDir, `${code}.docx`), zip.generate({ type: "nodebuffer" }) as Buffer);
  writeFileSync(join(mapDir, `${code}.json`), `${JSON.stringify(map, null, 2)}\n`);
  console.log(`${code} ok`);
}

export { appendFooterLine, fillAfterLabel, findRow, fillEmptyRow, setCellContaining, stampFooters, readXml, writeXml };

// Run only as `pnpm templates:prepare`; the November 2026 script imports the tagging above.
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/prepare-templates.ts")) {
  mkdirSync(mapDir, { recursive: true });
  for (const code of Object.keys(SOURCES)) {
    const built = tagOfficial(code);
    publish(code, built.zip, built.map);
  }
  const base = load(SOURCES["F-26"] ?? "");
  for (const built of buildReconstructed(base)) publish(built.code, built.zip, built.map);
  console.log("templates ready");
}
