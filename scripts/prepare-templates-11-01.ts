import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { uscForms11 } from "../prisma/seed/usc-rec/forms-11-01";
import { findRow, readXml, writeXml } from "./prepare-templates";
import { deleteTableRow, paragraphXml, replaceInCell, setCellText, tableGrid } from "@/lib/docs/ooxml";
import { checkPlaceholderMap, placeholderMapSchema, tagsFromDocumentXml, type PlaceholderMap } from "@/lib/docs/tags";

/**
 * Templates for version 11-01 (INTAKE-01), derived from the tagged November 2026 set in
 * templates/2026-11/. The official layout is unchanged; only placeholders move:
 * - F-27 and F-28: one signature row per researcher, each with its own date;
 * - F-30: the Ethics Review Fee prints in the column the proponent chose;
 * - F-38: the type of review boxes, and every researcher's signature.
 * The other forms keep the 2026 template and map; their proponent values now come from the intake.
 * Output: templates/11-01/{code}.docx and templates/11-01/maps/{code}.json.
 * Run: node --experimental-transform-types --import ./scripts/register-ts.mjs scripts/prepare-templates-11-01.ts
 */

const root = process.cwd();
const SOURCE = join(root, "templates", "2026-11");
export const TEMPLATE_DIR_11 = join(root, "templates", "11-01");
const mapDir = join(TEMPLATE_DIR_11, "maps");

type Built = { zip: PizZip; map: PlaceholderMap };

function open(code: string): { zip: PizZip; xml: string; map: PlaceholderMap } {
  const zip = new PizZip(readFileSync(join(SOURCE, `${code}.docx`)));
  const map = placeholderMapSchema.parse(JSON.parse(readFileSync(join(SOURCE, "maps", `${code}.json`), "utf8")));
  return { zip, xml: readXml(zip, "word/document.xml"), map };
}

function done(zip: PizZip, xml: string, map: PlaceholderMap): Built {
  writeXml(zip, "word/document.xml", xml);
  return { zip, map };
}

/** The shared header, with each bound header field listed as covered. */
function header(covers: Record<string, string[]>): PlaceholderMap {
  return {
    "protocol.code": { helper: "text", path: "protocol.code", covers: covers.code ?? [] },
    "protocol.title": { helper: "text", path: "protocol.title", covers: covers.title ?? [] },
    "protocol.versionLabel": { helper: "text", path: "protocol.versionLabel", covers: covers.version ?? [] },
    "protocol.researchers": { helper: "join", path: "protocol.researchers", covers: covers.researchers ?? [] },
  };
}

function tagApplication(): Built {
  const opened = open("F-27");
  let xml = opened.xml;
  const row = findRow(xml, "Signature of Proponents");
  const cells = tableGrid(xml)[row.table]?.[row.row] ?? [];
  if (cells.length < 3) throw new Error(`F-27: expected three cells on the signature row, found ${cells.length}.`);
  // The label cell holds "Signature of Proponents/" and "Researchers:" as two paragraphs; the name follows the second.
  xml = setCellText(xml, row.table, row.row, 0, "{#signers}Signature of Proponents/");
  xml = replaceInCell(xml, row.table, row.row, 0, "Researchers:", "Researchers: {name}");
  xml = setCellText(xml, row.table, row.row, 1, "{%sig}");
  xml = setCellText(xml, row.table, row.row, 2, "Date: {date}{/signers}");
  const box = (path: string, equals: string, covers?: string[]) => ({ helper: "checkbox" as const, path, includes: equals, ...(covers ? { covers } : {}) });
  const map: PlaceholderMap = {
    ...header({ code: ["protocol_code"], title: ["protocol_title"], version: ["version"], researchers: ["researchers"] }),
    "protocol.submissionDate": { helper: "date", path: "protocol.submissionDate", covers: ["submitted_on"] },
    "protocol.contactNumbers": { helper: "join", path: "protocol.contactNumbers", covers: ["contacts"] },
    "protocol.emails": { helper: "join", path: "protocol.emails", covers: ["emails"] },
    "protocol.institution": { helper: "text", path: "protocol.institution", covers: ["institution"] },
    "protocol.institutionAddress": { helper: "text", path: "protocol.institutionAddress", covers: ["address"] },
    cb_clinical: box("research_type", "CLINICAL_SPONSORED", ["research_type"]),
    cb_social: box("research_type", "SOCIAL_BEHAVIORAL"),
    cb_stem: box("research_type", "STEM_CELL"),
    cb_clinical_initiated: box("research_type", "CLINICAL_RESEARCHER"),
    cb_public_health: box("research_type", "PUBLIC_HEALTH"),
    cb_genetic: box("research_type", "GENETIC"),
    cb_health_ops: box("research_type", "HEALTH_OPERATIONS"),
    cb_biomedical: box("research_type", "BIOMEDICAL"),
    cb_research_other: box("research_type", "OTHER"),
    research_type_other: { helper: "text", path: "research_type_other" },
    duration: { helper: "text", path: "duration" },
    participants: { helper: "text", path: "participants" },
    study_site: { helper: "text", path: "study_site" },
    cb_fund_personal: box("funds", "RESEARCHER", ["funds"]),
    cb_fund_external: box("funds", "AGENCY"),
    cb_fund_internal: box("funds", "INSTITUTION"),
    cb_fund_other: box("funds", "OTHER"),
    fund_agency: { helper: "text", path: "fund_agency" },
    fund_internal_name: { helper: "text", path: "fund_institution" },
    fund_other_name: { helper: "text", path: "fund_other" },
    // Ticked when every researcher has agreed on the intake.
    cb_declare_truth: { helper: "checkbox", path: "intake.declarations", covers: ["declaration_1", "declaration_2", "declaration_3", "declaration_4", "declaration_5", "declaration_6"] },
    cb_declare_consent: { helper: "checkbox", path: "intake.declarations" },
    cb_declare_report: { helper: "checkbox", path: "intake.declarations" },
    cb_declare_conduct: { helper: "checkbox", path: "intake.declarations" },
    cb_declare_records: { helper: "checkbox", path: "intake.declarations" },
    cb_declare_privacy: { helper: "checkbox", path: "intake.declarations" },
    cb_conflict_none: { helper: "checkbox", path: "conflict", equals: "NONE", covers: ["conflict"] },
    cb_conflict_declared: { helper: "checkbox", path: "conflict", equals: "SPECIFY" },
    conflict_details: { helper: "text", path: "conflict_details" },
    signers: { helper: "signers", path: "proponent_signatures", columns: ["name", "sig", "date"], covers: ["proponent_signatures"], width: 150, height: 44 },
    signedFooter: { helper: "signedFooter" },
  };
  return done(opened.zip, xml, map);
}

function tagPrivacy(): Built {
  const opened = open("F-28");
  let xml = opened.xml;
  const first = findRow(xml, "1.");
  xml = setCellText(xml, first.table, first.row, 0, "{#signers}{no}. {name}");
  xml = setCellText(xml, first.table, first.row, 1, "{%sig}");
  xml = setCellText(xml, first.table, first.row, 2, "{date}{/signers}");
  const second = findRow(xml, "2.");
  if (second.table !== first.table) throw new Error("F-28: the second signer row is not in the signer table.");
  xml = deleteTableRow(xml, second.table, second.row);
  const map: PlaceholderMap = {
    ...header({ code: ["protocol_code"], title: ["protocol_title"], version: ["version"], researchers: ["researchers"] }),
    cb_consent_collect: { helper: "checkbox", path: "intake.consents", covers: ["consent_1", "policy"] },
    cb_consent_share: { helper: "checkbox", path: "intake.consents", covers: ["consent_2"] },
    signers: { helper: "signers", path: "signatures", columns: ["no", "name", "sig", "date"], covers: ["signatures"], width: 140, height: 42 },
    signedFooter: { helper: "signedFooter" },
  };
  return done(opened.zip, xml, map);
}

function tagBudget(): Built {
  const opened = open("F-30");
  let xml = opened.xml;
  const fee = findRow(xml, "Ethics Review Fee");
  ["personal", "external", "internal", "total"].forEach((column, index) => {
    xml = setCellText(xml, fee.table, fee.row, index + 1, `{fee_${column}}`);
  });
  const map: PlaceholderMap = {};
  for (const [tag, entry] of Object.entries(opened.map)) {
    if (tag === "ethics_fee" || tag === "rec_chair") continue;
    if (typeof entry === "object" && entry.extraPaths) {
      // The fee is a MOOE row now, so the sums need no extra paths.
      const rest = { ...entry };
      delete rest.extraPaths;
      map[tag] = rest;
      continue;
    }
    map[tag] = entry;
  }
  Object.assign(map, header({ code: ["protocol_code"], title: ["protocol_title"], version: ["version"], researchers: ["researchers"] }));
  for (const column of ["personal", "external", "internal", "total"]) {
    map[`fee_${column}`] = { helper: "budgetCell", path: "mooe", match: "fee", column };
  }
  map.external_source = { helper: "text", path: "external_source" };
  return done(opened.zip, xml, map);
}

function tagActions(): Built {
  const opened = open("F-38");
  let xml = opened.xml;
  const type = findRow(xml, "Type of Review:");
  xml = setCellText(xml, type.table, type.row, 1, "{cb_type_FULL} Full Review        {cb_type_EXPEDITED} Expedited Review");
  const researchers = findRow(xml, "Researcher(s)/ Proponent(s):");
  // The image module needs each signature in a paragraph of its own: loop over three paragraphs.
  xml = replaceInCell(xml, researchers.table, researchers.row, 1, "{%sig_researcher}", "{#signers}");
  const loopAt = xml.indexOf("{#signers}");
  const end = xml.indexOf("</w:p>", loopAt) + "</w:p>".length;
  xml = xml.slice(0, end) + paragraphXml("{%sig}") + paragraphXml("{name}{/signers}") + xml.slice(end);
  const map: PlaceholderMap = { ...opened.map };
  delete map.sig_researcher;
  Object.assign(map, {
    cb_type_FULL: { helper: "checkbox", path: "system.reviewType", equals: "FULL" },
    cb_type_EXPEDITED: { helper: "checkbox", path: "system.reviewType", equals: "EXPEDITED" },
    signers: { helper: "signers", path: "researcher_signature", columns: ["name", "sig"], covers: ["researcher_signature"], width: 120, height: 36 },
  });
  return done(opened.zip, xml, map);
}

function copied(code: string): Built {
  const opened = open(code);
  return { zip: opened.zip, map: opened.map };
}

const builders: Record<string, () => Built> = {
  "F-26": () => copied("F-26"),
  "F-27": tagApplication,
  "F-28": tagPrivacy,
  "F-30": tagBudget,
  "F-35": () => copied("F-35"),
  "F-36": () => copied("F-36"),
  "F-38": tagActions,
};

function publish(code: string, built: Built): void {
  const form = uscForms11.find((item) => item.code === code);
  if (!form) throw new Error(`No 11-01 schema for ${code}`);
  const parts = built.zip.file(/word\/(document|footer\d+|header\d+)\.xml/).map((file) => ({ name: file.name, xml: file.asText() }));
  const check = checkPlaceholderMap({ tags: tagsFromDocumentXml(parts), map: built.map, schema: form.schema });
  if (check.unmappedTags.length || check.unmappedFields.length) {
    throw new Error(`${code} unmapped tags: ${check.unmappedTags.join(", ") || "none"}\nunmapped fields: ${check.unmappedFields.join(", ") || "none"}`);
  }
  writeFileSync(join(TEMPLATE_DIR_11, `${code}.docx`), built.zip.generate({ type: "nodebuffer" }) as Buffer);
  writeFileSync(join(mapDir, `${code}.json`), `${JSON.stringify(built.map, null, 2)}\n`);
  console.log(`${code} ok`);
}

mkdirSync(mapDir, { recursive: true });
const only = process.argv.slice(2);
for (const [code, build] of Object.entries(builders)) {
  if (only.length > 0 && !only.includes(code)) continue;
  publish(code, build());
}
