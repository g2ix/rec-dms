import { readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { uscForms } from "../../../prisma/seed/usc-rec/forms";
import { generatedFileWhere } from "@/lib/docs/cache";
import { fillDocx } from "@/lib/docs/fill-docx";
import { copyName, mergePdfs, zipFiles } from "@/lib/docs/package";
import { checkPlaceholderMap, placeholderMapSchema, tagsFromDocumentXml } from "@/lib/docs/tags";
import { buildRenderModel, signedFooterLine } from "@/lib/docs/view";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import type { FormSchema } from "@/lib/forms/schema";

function tagsIn(bytes: Buffer) {
  const zip = new PizZip(bytes);
  return tagsFromDocumentXml(
    Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => ({ name: file.name, xml: file.asText() })),
  );
}

describe("document templates", () => {
  it("maps every committed template onto its form", () => {
    for (const form of uscForms) {
      const docx = readFileSync(join(process.cwd(), "templates", `${form.code}.docx`));
      const map = placeholderMapSchema.parse(
        JSON.parse(readFileSync(join(process.cwd(), "templates", "maps", `${form.code}.json`), "utf8")),
      );
      const check = checkPlaceholderMap({ tags: tagsIn(docx), map, schema: form.schema as FormSchema });
      expect(check.unmappedTags, form.code).toEqual([]);
      expect(check.unmappedFields, form.code).toEqual([]);
    }
  });

  it("fills the official F-26 file without rebuilding its layout", () => {
    const map = placeholderMapSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "templates", "maps", "F-26.json"), "utf8")));
    const model = buildRenderModel({
      map,
      data: { submission_type: "INITIAL", remarks: "Checked." },
      bound: PREVIEW_BOUND_VALUES,
      signatures: [],
    });
    const filled = fillDocx(readFileSync(join(process.cwd(), "templates", "F-26.docx")), model.data, model.images);
    const xml = new PizZip(filled).file("word/document.xml")?.asText() ?? "";
    expect(xml).toContain("USC-REC-2026-0001");
    expect(xml).toContain("Classroom study of study habits");
    expect(xml).toContain("☑");
    expect(xml).not.toContain("{protocol.code}");
  });

  it("prints the electronic signature line", () => {
    const line = signedFooterLine([
      {
        fieldPath: "chair_signature",
        signerName: "Maria Santos",
        signedAt: new Date("2026-11-06T02:30:00.000Z"),
        verifyRef: "REF123",
        image: null,
      },
    ]);
    expect(line).toBe("Signed electronically by Maria Santos, 2026-11-06 10:30 PHT, ref REF123");
  });
});

describe("packages", () => {
  it("keeps the official name for a single copy and numbers the rest", () => {
    expect(copyName("F-35 Protocol Review Assessment Form.pdf", 0, 1)).toBe(
      "F-35 Protocol Review Assessment Form.pdf",
    );
    expect(copyName("F-35 Protocol Review Assessment Form.pdf", 1, 2)).toBe(
      "F-35 Protocol Review Assessment Form (2).pdf",
    );
  });

  it("merges PDFs and names zip entries", async () => {
    async function page(text: string) {
      const doc = await PDFDocument.create();
      doc.addPage().drawText(text);
      return doc.save();
    }
    const merged = await PDFDocument.load(await mergePdfs([await page("one"), await page("two")]));
    expect(merged.getPageCount()).toBe(2);
    const zip = new PizZip(zipFiles([
      { name: "F-26 Document Receipt Form.pdf", bytes: await page("a") },
      { name: "Cover Letter.pdf", bytes: await page("b") },
    ]));
    expect(Object.keys(zip.files)).toEqual(["F-26 Document Receipt Form.pdf", "Cover Letter.pdf"]);
  });

  it("reuses a locked form at any revision and a working form only at its revision", () => {
    expect(generatedFileWhere({ status: "LOCKED", revision: 4, kind: "GENERATED_PDF" })).toEqual({
      kind: "GENERATED_PDF",
    });
    expect(generatedFileWhere({ status: "DRAFT", revision: 4, kind: "GENERATED_DOCX" })).toEqual({
      kind: "GENERATED_DOCX",
      sourceRevision: 4,
    });
  });
});
