import PizZip from "pizzip";

/** Reads the first worksheet of an .xlsx file as rows of cell text keyed by column letter. */
export function readFirstSheet(bytes: ArrayBuffer | Uint8Array | Buffer): { row: number; cells: Record<string, string> }[] {
  const zip = new PizZip(bytes as ArrayBuffer);
  const shared = sharedStrings(zip.file("xl/sharedStrings.xml")?.asText() ?? "");
  const sheetPath = firstSheetPath(zip);
  const xml = zip.file(sheetPath)?.asText();
  if (!xml) throw new Error("The workbook has no worksheet.");
  const rows: { row: number; cells: Record<string, string> }[] = [];
  for (const found of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const match = [found[0], /\br="(\d+)"/.exec(found[1] ?? "")?.[1], found[2]] as const;
    const cells: Record<string, string> = {};
    for (const cell of (match[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? "";
      const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
      if (!ref) continue;
      const inner = cell[2] ?? "";
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let value = "";
      if (type === "inlineStr") value = textOf(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
        value = type === "s" ? (shared[Number(raw)] ?? "") : decode(raw);
      }
      cells[ref[1]!] = value;
    }
    rows.push({ row: Number(match[1] ?? rows.length + 1), cells });
  }
  return rows;
}

function firstSheetPath(zip: PizZip): string {
  const workbook = zip.file("xl/workbook.xml")?.asText() ?? "";
  const rels = zip.file("xl/_rels/workbook.xml.rels")?.asText() ?? "";
  const rid = /<sheet\b[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : undefined;
  if (!target) return "xl/worksheets/sheet1.xml";
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1] ?? ""));
}

function textOf(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decode(match[1] ?? "")).join("");
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}
