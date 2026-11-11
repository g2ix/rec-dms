import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { F41_CRITERIA } from "../prisma/seed/usc-rec/points";
import { F26_ITEMS_10, F35_POINTS_10, F36_POINTS_10 } from "../prisma/seed/usc-rec/points-2026-11";
import { uscForms2026 } from "../prisma/seed/usc-rec/forms-2026-11";
import { fillAfterLabel, findRow, readXml, stampFooters, tagOfficial, writeXml } from "./prepare-templates";
import { deleteTableRow, replaceAcrossRuns, replaceInCell, setCellText, tableGrid } from "@/lib/docs/ooxml";
import { checkPlaceholderMap, tagsFromDocumentXml, type PlaceholderMap } from "@/lib/docs/tags";

/**
 * Tags the official November 2026 Word files (docs/forms/source/USC REC F-xx - ….docx) for the
 * 2026 form versions. Output: templates/2026-11/{code}.docx and templates/2026-11/maps/{code}.json.
 * The 2025 templates in templates/ stay as they are for protocols that started on the 2025 forms.
 * Run: node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/prepare-templates-2026-11.ts [F-xx ...]
 */

const root = process.cwd();
export const TEMPLATE_DIR_2026 = join(root, "templates", "2026-11");
const mapDir = join(TEMPLATE_DIR_2026, "maps");

export const SOURCES_2026: Record<string, string> = {
  "F-26": "USC REC F-26 - Document Receipt Form.docx",
  "F-27": "USC REC F-27 - Research Protocol Application Form.docx",
  "F-28": "USC REC F-28 - Data Privacy Consent Form.docx",
  "F-30": "USC REC F-30 - Detailed Budget Sheet.docx",
  "F-31": "USC REC F-31 - Form on Determining the Type of Review.docx",
  "F-35": "USC REC F-35 - Protocol Review Assessment Form.docx",
  "F-36": "USC REC F-36 - Informed Consent Form Assessment Checklist.docx",
  "F-37": "USC REC F-37 - Summary of Reviewers Comments.docx",
  "F-38": "USC REC F-38 - Summary of Actions Taken.docx",
  "F-39": "USC REC F-39 - Notification of REC Decision.docx",
  "F-40": "USC REC F-40 - Certification of Approval.docx",
  "F-41": "USC REC F-41 - Checklist for Exemption from Review.docx",
  "F-42": "USC REC F-42 - Certification of Exemption from Review.docx",
};

type Built = { zip: PizZip; map: PlaceholderMap };

function publish(code: string, zip: PizZip, map: PlaceholderMap): void {
  const form = uscForms2026.find((item) => item.code === code);
  if (!form) throw new Error(`No 2026 schema for ${code}`);
  const parts = zip.file(/word\/(document|footer\d+|header\d+)\.xml/).map((file) => ({ name: file.name, xml: file.asText() }));
  const check = checkPlaceholderMap({ tags: tagsFromDocumentXml(parts), map, schema: form.schema });
  if (check.unmappedTags.length || check.unmappedFields.length) {
    throw new Error(`${code} unmapped tags: ${check.unmappedTags.join(", ") || "none"}\nunmapped fields: ${check.unmappedFields.join(", ") || "none"}`);
  }
  writeFileSync(join(TEMPLATE_DIR_2026, `${code}.docx`), zip.generate({ type: "nodebuffer" }) as Buffer);
  writeFileSync(join(mapDir, `${code}.json`), `${JSON.stringify(map, null, 2)}\n`);
  console.log(`${code} ok`);
}

function rowId(code: string): string {
  return `p${code.replaceAll(".", "")}`;
}

function open(code: string): { zip: PizZip; xml: string } {
  const zip = new PizZip(readFileSync(join(root, "docs", "forms", "source", SOURCES_2026[code] ?? "")));
  return { zip, xml: readXml(zip, "word/document.xml") };
}

function done(zip: PizZip, xml: string, map: PlaceholderMap): Built {
  writeXml(zip, "word/document.xml", xml);
  stampFooters(zip);
  return { zip, map: { ...map, signedFooter: { helper: "signedFooter" } } };
}

/** Code, title, version and researchers in the usual header table. */
function header(xml: string, covers: string[] = []): { xml: string; map: PlaceholderMap } {
  let next = fillAfterLabel(xml, "Protocol Code", "{protocol.code}");
  next = fillAfterLabel(next, "Protocol Title", "{protocol.title}");
  next = fillAfterLabel(next, "Ver.", "{protocol.versionLabel}");
  next = fillAfterLabel(next, "Researcher(s)", "{protocol.researchers}");
  return {
    xml: next,
    map: {
      "protocol.code": { helper: "text", path: "protocol.code", ...(covers.length ? { covers } : {}) },
      "protocol.title": { helper: "text", path: "protocol.title" },
      "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel" },
      "protocol.researchers": { helper: "join", path: "protocol.researchers" },
    },
  };
}

/** The first row of `table` from `fromRow` on that passes `test`. */
function rowWhere(xml: string, table: number, fromRow: number, test: (cells: string[]) => boolean): number {
  const rows = tableGrid(xml)[table] ?? [];
  for (let row = fromRow; row < rows.length; row += 1) if (test(rows[row] ?? [])) return row;
  throw new Error(`No matching row in table ${table} after row ${fromRow}.`);
}

function tableOf(xml: string, text: string): number {
  return findRow(xml, text).table;
}

function boxes(map: PlaceholderMap, prefix: string, path: string, values: string[]) {
  values.forEach((value, index) => {
    map[`cb_${prefix}_${value}`] = { helper: "checkbox", path, equals: value, ...(index === 0 ? { covers: [path.split(".")[0]!] } : {}) };
  });
}

/** F-35 and F-36: page and line, three boxes, comments and recommendations for every printed point. */
function tagAssessment(code: "F-35" | "F-36"): Built {
  const points = code === "F-35" ? F35_POINTS_10 : F36_POINTS_10;
  const opened = open(code);
  const head = header(opened.xml, ["instructions"]);
  let xml = head.xml;
  const map: PlaceholderMap = { ...head.map };
  const table = tableOf(xml, "ASSESSMENT POINTS");
  const rows = tableGrid(xml)[table] ?? [];
  let current: string | null = null;
  const seen = new Set<string>();
  const matchPoint = (text: string): string | null => {
    if (code === "F-36") {
      if (text.startsWith("Is it necessary")) return "1";
      if (text.startsWith("If NO,")) return "1.NO";
      if (/^D\.\s/.test(text)) return "D";
      return text.match(/^([A-C]\.\d{2})\.?\s/)?.[1] ?? null;
    }
    if (/^4\.\s+DO YOU/i.test(text)) return "4";
    return text.match(/^(\d\.\d{2}(?:\.\d)?)\.?\s/)?.[1] ?? null;
  };
  for (let row = 0; row < rows.length; row += 1) {
    const cells = rows[row] ?? [];
    const first = cells[0] ?? "";
    const found = matchPoint(first);
    if (found) {
      current = found;
      seen.add(found);
      const id = rowId(found);
      cells.forEach((text, index) => {
        if (index === 0) return;
        if (/^p\. _+, line _+$/.test(text.trim())) {
          xml = setCellText(xml, table, row, index, `{${id}_page}`);
          map[`${id}_page`] = { helper: "text", path: `points.${id}.page` };
          return;
        }
        if (!text.includes("☐")) return;
        const word = text.replace("☐", "").trim();
        const value = word.startsWith("UNABLE") ? "UNABLE" : word.startsWith("YES") ? "YES" : word.startsWith("NO") ? "NO" : null;
        if (!value) return;
        xml = replaceInCell(xml, table, row, index, "☐", `{cb_${id}_${value}}`);
        map[`cb_${id}_${value}`] = { helper: "checkbox", path: `points.${id}.assessment`, equals: value };
      });
      continue;
    }
    if (!current) continue;
    const id = rowId(current);
    if (first.startsWith("Detailed Comments")) {
      xml = setCellText(xml, table, row, 1, `{${id}_comments}`);
      map[`${id}_comments`] = { helper: "text", path: `points.${id}.comments` };
    } else if (first.startsWith("Specific Recommendations")) {
      xml = setCellText(xml, table, row, 1, `{${id}_recommendations}`);
      map[`${id}_recommendations`] = { helper: "text", path: `points.${id}.recommendations`, ...(current === points[0]!.code ? { covers: ["points"] } : {}) };
    }
  }
  const missing = points.filter((point) => !seen.has(point.code)).map((point) => point.code);
  if (missing.length > 0) throw new Error(`${code}: points not found on the Word file: ${missing.join(", ")}`);
  const action = tableOf(xml, "RECOMMENDED ACTION:");
  for (const value of ["APPROVED", "MINOR", "MAJOR", "DISAPPROVED"]) {
    const row = rowWhere(xml, action, 0, (cells) => (cells[1] ?? "").startsWith(value));
    xml = setCellText(xml, action, row, 0, `{cb_action_${value}}`);
  }
  boxes(map, "action", "recommended_action", ["APPROVED", "MINOR", "MAJOR", "DISAPPROVED"]);
  const justification = rowWhere(xml, action, 0, (cells) => (cells[0] ?? "").startsWith("JUSTIFICATION"));
  xml = setCellText(xml, action, justification, 0, "JUSTIFICATION: {justification}");
  map.justification = { helper: "text", path: "justification" };
  const signer = tableOf(xml, "PRIMARY REVIEWER:");
  const line = rowWhere(xml, signer, 0, (cells) => /^_+$/.test((cells[2] ?? "").trim()));
  xml = setCellText(xml, signer, line, 1, "{%sig_reviewer}");
  xml = setCellText(xml, signer, line, 2, "{reviewer_name}");
  xml = setCellText(xml, signer, line, 3, "{review_date}");
  Object.assign(map, {
    sig_reviewer: { helper: "signature", path: "reviewer_signature", width: 150, height: 44 },
    reviewer_name: { helper: "text", path: "reviewer_name" },
    review_date: { helper: "date", path: "review_date" },
  });
  return done(opened.zip, xml, map);
}

/**
 * Replaces the printed point rows of a summary table with one loop row. The loop prints each point
 * that has text, in form order, with flagged points highlighted; the section heading rows go.
 */
function loopRows(xml: string, table: number, cellsFor: (count: number) => string[]): string {
  const rows = tableGrid(xml)[table] ?? [];
  const firstPoint = rows.findIndex((cells) => /^(\d\.\d{2}|[A-D]\.\d{2})\.?$/.test((cells[0] ?? "").trim()));
  if (firstPoint < 0) throw new Error(`No point rows in table ${table}.`);
  const startRow = rows.findIndex((cells) => (cells[0] ?? "").startsWith("ASSESSMENT POINTS")) + 1;
  const endRow = rows.findIndex((cells) => (cells[0] ?? "").startsWith("RECOMMENDED ACTION"));
  if (startRow <= 0 || endRow < 0) throw new Error(`Table ${table} has no header or no recommended action row.`);
  let next = xml;
  cellsFor((rows[firstPoint] ?? []).length).forEach((text, index) => {
    next = setCellText(next, table, firstPoint, index, text);
  });
  for (let row = endRow - 1; row >= startRow; row -= 1) {
    if (row !== firstPoint) next = deleteTableRow(next, table, row);
  }
  return next;
}

function tagSummary(): Built {
  const opened = open("F-37");
  const head = header(opened.xml, ["copied_note"]);
  let xml = head.xml;
  const map: PlaceholderMap = { ...head.map };
  const type = findRow(xml, "Type of Review:");
  xml = setCellText(xml, type.table, type.row, 1, "{cb_type_Full} Full Review    {cb_type_Expedited} Expedited Review");
  map.cb_type_Full = { helper: "checkbox", path: "review_type", equals: "Full", covers: ["review_type", "reviewed_by"] };
  map.cb_type_Expedited = { helper: "checkbox", path: "review_type", equals: "Expedited" };
  xml = replaceInCell(xml, type.table, findRow(xml, "Form Contents Prepared by:").row, 1, "<signature above printed name>", "{%sig_staff}");
  xml = replaceInCell(xml, type.table, findRow(xml, "Form Contents Reviewed by:").row, 1, "<signature above printed name>", "{%sig_secretary}");
  xml = fillAfterLabel(xml, "Date reviewed:", "{review_date}");
  Object.assign(map, {
    sig_staff: { helper: "signature", path: "prepared_by", width: 140, height: 40 },
    sig_secretary: { helper: "signature", path: "secretary_review", width: 140, height: 40 },
    review_date: { helper: "date", path: "review_date" },
  });
  for (const [anchor, field, action, justification] of [
    ["PROTOCOL REVIEW ASSESSMENT FORM", "praf", "recommended_action", "justification"],
    ["INFORMED CONSENT FORM (ICF) CHECKLIST", "icf", "icf_action", "icf_justification"],
  ] as const) {
    const table = tableOf(xml, anchor);
    xml = loopRows(xml, table, (count) =>
      count >= 4 ? [`{#${field}}{code}`, "{label}", "{comments}", `{recommendations}{/${field}}`] : [`{#${field}}{code} {label}`, "{comments}", `{recommendations}{/${field}}`],
    );
    map[field] = {
      helper: "assessmentRows",
      path: field,
      columns: ["code", "label", "comments", "recommendations"],
      onlyFilled: ["comments", "recommendations"],
      highlightIf: "needs_action",
    };
    const actionRow = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("RECOMMENDED ACTION"));
    xml = setCellText(xml, table, actionRow, 1, `{${action}}`);
    map[action] = { helper: "choice", path: action };
    const label = rowWhere(xml, table, actionRow, (cells) => (cells[0] ?? "").startsWith("JUSTIFICATION"));
    xml = setCellText(xml, table, label + 1, 0, `{${justification}}`);
    map[justification] = { helper: "text", path: justification };
  }
  const endorse = tableOf(xml, "Endorsed by:");
  const line = rowWhere(xml, endorse, 0, (cells) => (cells[2] ?? "").startsWith("Signature over printed name"));
  xml = setCellText(xml, endorse, line, 1, "{%sig_chair}");
  xml = setCellText(xml, endorse, line, 3, "{chair_signed_on}");
  Object.assign(map, {
    sig_chair: { helper: "signature", path: "chair_endorsement", width: 150, height: 44 },
    chair_signed_on: { helper: "date", path: "chair_endorsement" },
  });
  return done(opened.zip, xml, map);
}

function tagActions(): Built {
  const opened = open("F-38");
  let xml = fillAfterLabel(opened.xml, "Protocol Code", "{protocol.code}");
  xml = fillAfterLabel(xml, "Protocol Title", "{protocol.title}");
  const title = findRow(xml, "Protocol Title");
  xml = setCellText(xml, title.table, title.row, 3, "{protocol.versionLabel}");
  xml = replaceInCell(xml, title.table, findRow(xml, "Researcher(s)/ Proponent(s):").row, 1, "<signature above printed name>", "{%sig_researcher}");
  xml = fillAfterLabel(xml, "Date Accomplished:", "{accomplished_on}");
  xml = replaceInCell(xml, title.table, findRow(xml, "Actions Taken Reviewed by:").row, 1, "<signature above printed name>", "{%sig_adviser}");
  const map: PlaceholderMap = {
    "protocol.code": { helper: "text", path: "protocol.code" },
    "protocol.title": { helper: "text", path: "protocol.title" },
    "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel" },
    sig_researcher: { helper: "signature", path: "researcher_signature", width: 140, height: 40 },
    accomplished_on: { helper: "date", path: "researcher_signature" },
    sig_adviser: { helper: "signature", path: "adviser_signature", width: 140, height: 40 },
  };
  const parts = [
    ["SUMMARY OF ACTIONS TAKEN ON THE STUDY PROTOCOL", "praf", ""],
    ["SUMMARY OF ACTIONS TAKEN ON THE INFORMED CONSENT FORM", "icf", "icf_"],
  ] as const;
  const signerTables = tableGrid(xml)
    .map((rows, index) => ((rows[0]?.[0] ?? "").startsWith("PRIMARY REVIEWER") ? index : -1))
    .filter((index) => index >= 0);
  if (signerTables.length !== 2) throw new Error(`F-38: expected two reviewer blocks, found ${signerTables.length}.`);
  // Tag the ICF part first so the table numbers of the protocol part do not move.
  for (const [partIndex, [anchor, field, prefix]] of [...parts.entries()].reverse()) {
    const signer = signerTables[partIndex]!;
    const line = rowWhere(xml, signer, 0, (cells) => /^_+$/.test((cells[2] ?? "").trim()));
    xml = setCellText(xml, signer, line, 1, `{%sig_${field}_reviewer}`);
    xml = setCellText(xml, signer, line, 2, `{${prefix}reviewer_name}`);
    xml = setCellText(xml, signer, line, 3, `{${prefix}review_date}`);
    map[`sig_${field}_reviewer`] = { helper: "signature", path: `${prefix}reviewer_signature`, width: 150, height: 44 };
    map[`${prefix}reviewer_name`] = { helper: "text", path: `${prefix}reviewer_name` };
    map[`${prefix}review_date`] = { helper: "date", path: `${prefix}review_date` };
    const table = tableOf(xml, anchor);
    xml = loopRows(xml, table, () => [`{#${field}}{code}`, "{label}", "{panel_comments}", "", "{actions_taken}", `{panel_remarks}{/${field}}`]);
    map[field] = {
      helper: "assessmentRows",
      path: field,
      columns: ["code", "label", "panel_comments", "actions_taken", "panel_remarks"],
      onlyFilled: ["needs_action", "panel_comments"],
      highlightIf: "needs_action",
    };
    const action = prefix ? "icf_action" : "recommended_action";
    const actionRow = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("RECOMMENDED ACTION"));
    xml = setCellText(xml, table, actionRow, 0, `RECOMMENDED ACTION: {${action}}`);
    map[action] = { helper: "choice", path: action };
    const justification = `${prefix}justification`;
    const label = rowWhere(xml, table, actionRow, (cells) => (cells[0] ?? "").startsWith("JUSTIFICATION"));
    xml = setCellText(xml, table, label, 0, `JUSTIFICATION FOR RECOMMENDATION: {${justification}}`);
    map[justification] = { helper: "text", path: justification };
  }
  return done(opened.zip, xml, map);
}

function tagReceipt(): Built {
  const opened = open("F-26");
  const head = header(opened.xml);
  let xml = fillAfterLabel(head.xml, "Contact No.", "{protocol.contactNumbers}");
  xml = fillAfterLabel(xml, "Email of", "{protocol.emails}");
  xml = fillAfterLabel(xml, "Institution:", "{protocol.institution}");
  const map: PlaceholderMap = {
    ...head.map,
    "protocol.contactNumbers": { helper: "join", path: "protocol.contactNumbers" },
    "protocol.emails": { helper: "join", path: "protocol.emails" },
    "protocol.institution": { helper: "text", path: "protocol.institution" },
  };
  const table = tableOf(xml, "Initial Submission");
  for (const [label, left, right] of [
    ["Initial Submission", "INITIAL", "COMPLETION"],
    ["Resubmission for re-review", "RESUBMISSION", "CONTINUING"],
    ["Protocol Amendments", "AMENDMENT", "TERMINATION"],
  ] as const) {
    const row = findRow(xml, label).row;
    xml = setCellText(xml, table, row, 1, `{cb_sub_${left}}`);
    xml = setCellText(xml, table, row, 3, `{cb_sub_${right}}`);
  }
  const others = findRow(xml, "Others:").row;
  xml = setCellText(xml, table, others, 1, "{cb_sub_OTHER}");
  xml = replaceInCell(xml, table, others, 2, "<please specify>", "{submission_other}");
  boxes(map, "sub", "submission_type", ["INITIAL", "COMPLETION", "RESUBMISSION", "CONTINUING", "AMENDMENT", "TERMINATION", "OTHER"]);
  map.submission_other = { helper: "text", path: "submission_other" };
  const list = tableOf(xml, "Mandatory Documents");
  for (const item of F26_ITEMS_10) {
    const row = rowWhere(xml, list, 0, (cells) => (cells[0] ?? "").trim() === item.code);
    const id = rowId(item.code);
    ["YES", "NO", "NA"].forEach((value, index) => {
      xml = setCellText(xml, list, row, 2 + index, `{cb_${id}_${value}}`);
      map[`cb_${id}_${value}`] = { helper: "checkbox", path: `documents.${id}.present`, equals: value, ...(item.code === "1" && index === 0 ? { covers: ["documents"] } : {}) };
    });
  }
  const remarks = rowWhere(xml, list, 0, (cells) => (cells[0] ?? "").startsWith("Remarks"));
  xml = setCellText(xml, list, remarks + 1, 0, "{remarks}");
  const received = findRow(xml, "Received by:");
  xml = setCellText(xml, received.table, received.row, 1, "{%sig_received}");
  xml = setCellText(xml, received.table, received.row, 3, "{received_date}");
  Object.assign(map, {
    remarks: { helper: "text", path: "remarks" },
    sig_received: { helper: "signature", path: "received_by", width: 160, height: 48 },
    received_date: { helper: "date", path: "received_date" },
  });
  return done(opened.zip, xml, map);
}

function tagDetermination(): Built {
  const opened = open("F-31");
  const head = header(opened.xml);
  let xml = head.xml;
  const map: PlaceholderMap = { ...head.map };
  const table = tableOf(xml, "Type of Submission");
  const pairs: [string, number, string][] = [
    ["Initial Submission", 0, "sub_INITIAL"],
    ["Initial Submission", 2, "sub_CONTINUING"],
    ["Protocol Amendment Application", 0, "sub_AMENDMENT"],
    ["Protocol Amendment Application", 2, "sub_DEVIATION"],
    ["Final Report", 0, "sub_FINAL_REPORT"],
    ["Final Report", 2, "sub_TERMINATION"],
    ["Appeal", 0, "sub_APPEAL"],
    ["Appeal", 2, "sub_UAP_AE"],
    ["Others: (Please specify)", 0, "sub_OTHER"],
    ["Below minimal risk", 0, "risk_BELOW_MINIMAL"],
    ["Below minimal risk", 2, "risk_MINIMAL"],
    ["Greater than minimal risk", 0, "risk_GREATER"],
    ["Greater than minimal risk", 2, "risk_NONE"],
    ["Expedited Review", 0, "review_EXPEDITED"],
    ["Expedited Review", 2, "review_FULL"],
  ];
  for (const [label, index, tag] of pairs) {
    const row = rowWhere(xml, table, 0, (cells) => (cells[1] ?? "").trim() === label);
    xml = setCellText(xml, table, row, index, `{cb_${tag}}`);
  }
  for (const [question, prefix] of [
    ["Can the Study Protocol be Exempt from Review?", "exempt"],
    ["Is Informed Consent needed?", "consent"],
    ["Does the researcher request waiver of consent?", "waiver"],
  ] as const) {
    const row = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith(question)) + 1;
    xml = setCellText(xml, table, row, 0, `{cb_${prefix}_YES}`);
    xml = setCellText(xml, table, row, 2, `{cb_${prefix}_NO}`);
  }
  const otherRow = rowWhere(xml, table, 0, (cells) => (cells[1] ?? "").startsWith("Others:"));
  xml = setCellText(xml, table, otherRow, 1, "Others: {submission_other}");
  boxes(map, "sub", "submission_type", ["INITIAL", "CONTINUING", "AMENDMENT", "DEVIATION", "FINAL_REPORT", "TERMINATION", "APPEAL", "UAP_AE", "OTHER"]);
  boxes(map, "risk", "risk", ["BELOW_MINIMAL", "MINIMAL", "GREATER", "NONE"]);
  boxes(map, "review", "review_type", ["EXPEDITED", "FULL"]);
  boxes(map, "exempt", "exempt", ["YES", "NO"]);
  boxes(map, "consent", "consent_needed", ["YES", "NO"]);
  boxes(map, "waiver", "consent_waiver", ["YES", "NO"]);
  map.submission_other = { helper: "text", path: "submission_other" };
  const justification = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "") === "Justification");
  xml = setCellText(xml, table, justification + 1, 0, "{justification}");
  const scientist = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("Scientist:"));
  xml = setCellText(xml, table, scientist, 0, "Scientist: {scientist_reviewer}");
  xml = setCellText(xml, table, scientist + 1, 0, "Non-Scientist: {non_scientist_reviewer}");
  const signature = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("Signature over Printed Name"));
  xml = setCellText(xml, table, signature - 1, 0, "{%sig_chair}");
  xml = setCellText(xml, table, signature + 1, 0, "{signed_on}");
  Object.assign(map, {
    justification: { helper: "text", path: "justification" },
    scientist_reviewer: { helper: "text", path: "scientist_reviewer" },
    non_scientist_reviewer: { helper: "text", path: "non_scientist_reviewer" },
    sig_chair: { helper: "signature", path: "accomplished_by", width: 160, height: 48 },
    signed_on: { helper: "date", path: "accomplished_by" },
  });
  return done(opened.zip, xml, map);
}

function tagLetter(): Built {
  const opened = open("F-39");
  const head = header(opened.xml, ["instructions"]);
  let xml = head.xml;
  const map: PlaceholderMap = { ...head.map };
  const date = findRow(xml, "Date of Review:");
  const table = date.table;
  xml = setCellText(xml, table, date.row, 1, "{review_date}");
  const typeRow = findRow(xml, "Type of Review:").row;
  xml = setCellText(xml, table, typeRow, 1, "{cb_type_FULL}");
  xml = setCellText(xml, table, typeRow + 1, 1, "{cb_type_EXPEDITED}");
  const submissionRow = findRow(xml, "Type of Submission:").row;
  xml = setCellText(xml, table, submissionRow, 1, "{cb_submission_INITIAL}");
  xml = setCellText(xml, table, submissionRow + 1, 1, "{cb_submission_RESUBMISSION}");
  xml = setCellText(xml, table, findRow(xml, "Documents under review:").row, 1, "{documents}");
  const decisionRow = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "") === "Decision");
  ["APPROVED", "MINOR", "MAJOR", "DISAPPROVED"].forEach((value, index) => {
    xml = setCellText(xml, table, decisionRow + index, 1, `{cb_decision_${value}}`);
  });
  xml = replaceAcrossRuns(xml, "[submission deadline]", "{deadline}");
  xml = replaceAcrossRuns(xml, "<copy Justification in the PRAF and ICF USC REC F-37 Summary of Reviewers’ Comments>", "{justification}");
  const signer = tableGrid(xml).findIndex((rows) => /^_+$/.test((rows[0]?.[0] ?? "").trim()));
  if (signer < 0) throw new Error("F-39: no signature table.");
  xml = setCellText(xml, signer, 0, 0, "{%sig_chair}");
  xml = replaceInCell(xml, signer, 1, 0, "Signature over printed name", "{signer_name}");
  xml = setCellText(xml, signer, 2, 0, "{signed_on}");
  boxes(map, "type", "review_type", ["FULL", "EXPEDITED"]);
  boxes(map, "submission", "submission_type", ["INITIAL", "RESUBMISSION"]);
  boxes(map, "decision", "decision", ["APPROVED", "MINOR", "MAJOR", "DISAPPROVED"]);
  Object.assign(map, {
    review_date: { helper: "date", path: "review_date" },
    documents: { helper: "text", path: "documents" },
    deadline: { helper: "date", path: "deadline" },
    justification: { helper: "text", path: "justification" },
    sig_chair: { helper: "signature", path: "chair_signature", width: 160, height: 48 },
    signer_name: { helper: "text", path: "rec.signerName" },
    signed_on: { helper: "date", path: "chair_signature" },
  });
  return done(opened.zip, xml, map);
}

/** F-40 and F-42: the dates come from the certificate settings when the decision is released. */
function tagCertificate(code: "F-40" | "F-42"): Built {
  const opened = open(code);
  let xml = fillAfterLabel(opened.xml, "Protocol Code", "{protocol.code}");
  xml = fillAfterLabel(xml, "Protocol Title", "{protocol.title}");
  xml = fillAfterLabel(xml, "Ver.", "{protocol.versionLabel}");
  xml = fillAfterLabel(xml, "Researcher(s)/Proponent(s)", "{protocol.researchers}");
  const map: PlaceholderMap = {
    "protocol.code": { helper: "text", path: "protocol.code" },
    "protocol.title": { helper: "text", path: "protocol.title" },
    "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel" },
    "protocol.researchers": { helper: "join", path: "protocol.researchers" },
    release_date: { helper: "date", path: "certificate.releaseDate" },
    valid_from: { helper: "date", path: "certificate.releaseDate" },
    valid_until: { helper: "date", path: "certificate.validUntil" },
    continuing_due: { helper: "date", path: "certificate.continuingReviewDue" },
    panel_number: { helper: "text", path: "panel_number" },
    funds: { helper: "text", path: "funds" },
    study_site: { helper: "text", path: "study_site" },
    sig_chair: { helper: "signature", path: "chair_signature", width: 160, height: 48 },
    signer_name: { helper: "text", path: "rec.signerName" },
  };
  if (code === "F-40") {
    xml = fillAfterLabel(xml, "Type of Review", "{review_type}");
    const meeting = findRow(xml, "Date of REC Meeting");
    xml = setCellText(xml, meeting.table, meeting.row, 2, "{meeting_date}");
    map.review_type = { helper: "text", path: "review_type" };
    map.meeting_date = { helper: "date", path: "meeting_date" };
  }
  xml = fillAfterLabel(xml, "Source(s) of Funds", "{funds}");
  xml = fillAfterLabel(xml, "Study Site", "{study_site}");
  xml = replaceAcrossRuns(xml, "< date >", "{release_date}");
  xml = replaceAcrossRuns(xml, "<number>", "{panel_number}");
  xml = replaceAcrossRuns(xml, "[start date]", "{valid_from}");
  xml = replaceAcrossRuns(xml, "[end date]", "{valid_until}");
  xml = replaceAcrossRuns(xml, "[Date - 30 days before expiration]", "{continuing_due}");
  if (code === "F-40") {
    xml = replaceAcrossRuns(xml, "[date]", "{progress_due}");
    map.progress_due = { helper: "date", path: "certificate.progressReportDue" };
    xml = replaceAcrossRuns(xml, "< Signature above name of Panel Chair >", "{%sig_chair} {signer_name}");
    xml = replaceAcrossRuns(
      xml,
      "Signature over printed name of researcher(s)/proponent(s)",
      "{%conforme_1} {%conforme_2} {%conforme_3} {%conforme_4} Signature over printed name of researcher(s)/proponent(s)",
    );
    xml = replaceAcrossRuns(xml, "Date: ___________________", "Date: {conforme_date}");
    for (const slot of [0, 1, 2, 3]) map[`conforme_${slot + 1}`] = { helper: "signature", path: "conforme", slot, width: 120, height: 36 };
    map.conforme_date = { helper: "date", path: "conforme" };
  } else {
    xml = replaceAcrossRuns(xml, "< Name of Panel Chair >", "{%sig_chair} {signer_name}");
  }
  return done(opened.zip, xml, map);
}

function tagExemption(): Built {
  const opened = open("F-41");
  const head = header(opened.xml);
  let xml = head.xml;
  const map: PlaceholderMap = { ...head.map };
  const table = tableOf(xml, "CRITERIA FOR EXEMPTION");
  const byText: [string, string[]][] = [
    ["Does this research involve human participants?", ["1.1"]],
    ["Does this research involve use of non-identifiable human tissue", ["1.2"]],
    ["Does this research involve use of non-identifiable publicly", ["1.3"]],
    ["Does this research involve interaction with human participants?", ["1.4"]],
    ["Type of research", ["1.5.1", "1.5.2", "1.5.3", "1.5.4", "1.5.5"]],
    ["What is/are the method/s of data collection", ["1.6.1", "1.6.2", "1.6.3"]],
    ["Will the collected data be anonymized", ["1.7"]],
    ["Is there a data protection plan?", ["1.8"]],
    ["Is this research likely to involve any foreseeable risk", ["1.9"]],
    ["Any vulnerable groups?", ["1.1.1"]],
    ["Highly Sensitive topics", ["1.1.2"]],
    ["Use of drugs", ["1.1.3"]],
    ["Invasive procedure", ["1.1.4"]],
    ["Physical stress/distress", ["1.1.5"]],
    ["Psychological/mental stress/distress", ["1.1.6"]],
    ["Deception of/or withholding", ["1.1.7"]],
    ["Access to data by individuals", ["1.1.8"]],
    ["Conflict of interest issues", ["1.1.9"]],
    ["Or any other ethical dilemmas", ["1.1.10"]],
    ["Is there any blood sampling involved", ["1.1.11"]],
  ];
  const placed = new Set<string>();
  for (const [text, codes] of byText) {
    const row = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith(text));
    const ids = codes.map(rowId);
    // Several criteria share one printed row: their boxes and comments are printed side by side.
    xml = setCellText(xml, table, row, 1, ids.map((id) => `{cb_${id}_YES}`).join(" "));
    xml = setCellText(xml, table, row, 2, ids.map((id) => `{cb_${id}_NO}`).join(" "));
    xml = setCellText(xml, table, row, 3, ids.map((id) => `{${id}_comments}`).join(" "));
    for (const id of ids) {
      map[`cb_${id}_YES`] = { helper: "checkbox", path: `criteria.${id}.answer`, equals: "YES", ...(placed.size === 0 ? { covers: ["criteria"] } : {}) };
      map[`cb_${id}_NO`] = { helper: "checkbox", path: `criteria.${id}.answer`, equals: "NO" };
      map[`${id}_comments`] = { helper: "text", path: `criteria.${id}.comments` };
      placed.add(id);
    }
  }
  const missing = F41_CRITERIA.map((item) => rowId(item.code)).filter((id) => !placed.has(id));
  if (missing.length > 0) throw new Error(`F-41 criteria not placed: ${missing.join(", ")}`);
  for (const [label, value] of [
    ["QUALIFIED FOR EXEMPTION", "QUALIFIED"],
    ["NOT QUALIFIED FOR EXEMPTION", "NOT_QUALIFIED"],
  ] as const) {
    const row = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").replace(/_+/, "").trim() === label);
    xml = setCellText(xml, table, row, 0, `{cb_action_${value}} ${label}`);
  }
  boxes(map, "action", "recommended_action", ["QUALIFIED", "NOT_QUALIFIED"]);
  const summary = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("SUMMARY OF RECOMMENDATIONS"));
  xml = setCellText(xml, table, summary, 0, "SUMMARY OF RECOMMENDATIONS: {summary}");
  xml = setCellText(xml, table, summary + 1, 0, "JUSTIFICATION FOR RECOMMENDED ACTION: {justification}");
  const chair = rowWhere(xml, table, 0, (cells) => (cells[0] ?? "").startsWith("PANEL CHAIR"));
  xml = setCellText(xml, table, chair, 3, "{%sig_chair}");
  xml = setCellText(xml, table, chair + 1, 0, "Date: {signed_on}");
  xml = setCellText(xml, table, chair + 1, 3, "{signer_name}");
  Object.assign(map, {
    summary: { helper: "text", path: "summary" },
    justification: { helper: "text", path: "justification" },
    sig_chair: { helper: "signature", path: "chair_signature", width: 160, height: 48 },
    signed_on: { helper: "date", path: "chair_signature" },
    signer_name: { helper: "text", path: "rec.signerName" },
  });
  return done(opened.zip, xml, map);
}

const builders: Record<string, () => Built> = {
  "F-26": tagReceipt,
  // F-27, F-28 and F-30 keep the 2025 layout, so the 2025 tagging applies unchanged.
  "F-27": () => tagOfficial("F-27", SOURCES_2026["F-27"]),
  "F-28": () => tagOfficial("F-28", SOURCES_2026["F-28"]),
  "F-30": () => tagOfficial("F-30", SOURCES_2026["F-30"]),
  "F-31": tagDetermination,
  "F-35": () => tagAssessment("F-35"),
  "F-36": () => tagAssessment("F-36"),
  "F-37": tagSummary,
  "F-38": tagActions,
  "F-39": tagLetter,
  "F-40": () => tagCertificate("F-40"),
  "F-41": tagExemption,
  "F-42": () => tagCertificate("F-42"),
};

mkdirSync(mapDir, { recursive: true });
const only = process.argv.slice(2);
for (const [code, build] of Object.entries(builders)) {
  if (only.length > 0 && !only.includes(code)) continue;
  const built = build();
  publish(code, built.zip, built.map);
}
