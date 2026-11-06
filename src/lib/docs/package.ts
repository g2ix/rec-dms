import { PDFDocument, StandardFonts } from "pdf-lib";
import PizZip from "pizzip";

export function copyName(name: string, index: number, total: number): string {
  if (total <= 1) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${stem} (${index + 1})${ext}`;
}

export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const doc = await PDFDocument.load(part);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}

export async function notePdf(message: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  page.drawText(message.slice(0, 400), { x: 72, y: 720, size: 12, font, maxWidth: 468 });
  return doc.save();
}

export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Buffer {
  const zip = new PizZip();
  const used = new Set<string>();
  for (const file of files) {
    let name = file.name || "file";
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let n = 2;
      while (used.has(`${stem} (${n})${ext}`)) n += 1;
      name = `${stem} (${n})${ext}`;
    }
    used.add(name);
    zip.file(name, file.bytes);
  }
  return zip.generate({ type: "nodebuffer" }) as Buffer;
}
