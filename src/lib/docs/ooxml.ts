/** Small OOXML helpers for tagging an existing .docx without rebuilding its tables. */

type CellRange = {
  table: number;
  row: number;
  cell: number;
  innerStart: number;
  innerEnd: number;
};

type RowRange = {
  table: number;
  row: number;
  start: number;
  end: number;
};

type Frame = {
  tag: "tbl" | "tr" | "tc";
  table: number;
  row: number;
  cell: number;
  contentStart: number;
  start: number;
};

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scan(xml: string): { cells: CellRange[]; rows: RowRange[] } {
  const cells: CellRange[] = [];
  const rows: RowRange[] = [];
  const stack: Frame[] = [];
  let nextTable = 0;
  const re = /<w:(tbl|tr|tc)\b[^>]*?>|<\/w:(tbl|tr|tc)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    const open = match[1] as Frame["tag"] | undefined;
    const close = match[2] as Frame["tag"] | undefined;
    if (open) {
      const parent = stack.at(-1);
      if (open === "tbl") {
        const table = nextTable;
        nextTable += 1;
        stack.push({ tag: "tbl", table, row: -1, cell: -1, contentStart: re.lastIndex, start: match.index });
      } else if (open === "tr" && parent?.tag === "tbl") {
        parent.row += 1;
        parent.cell = -1;
        stack.push({
          tag: "tr",
          table: parent.table,
          row: parent.row,
          cell: -1,
          contentStart: re.lastIndex,
          start: match.index,
        });
      } else if (open === "tc" && parent?.tag === "tr") {
        parent.cell += 1;
        stack.push({
          tag: "tc",
          table: parent.table,
          row: parent.row,
          cell: parent.cell,
          contentStart: re.lastIndex,
          start: match.index,
        });
      } else {
        stack.push({
          tag: open,
          table: parent?.table ?? -1,
          row: -1,
          cell: -1,
          contentStart: re.lastIndex,
          start: match.index,
        });
      }
      continue;
    }
    const frame = stack.pop();
    if (!frame || frame.tag !== close) continue;
    if (close === "tc" && stack.at(-1)?.tag === "tr") {
      cells.push({
        table: frame.table,
        row: frame.row,
        cell: frame.cell,
        innerStart: frame.contentStart,
        innerEnd: match.index,
      });
    }
    if (close === "tr" && stack.at(-1)?.tag === "tbl") {
      rows.push({ table: frame.table, row: frame.row, start: frame.start, end: re.lastIndex });
    }
  }
  return { cells, rows };
}

export function tableGrid(xml: string): string[][][] {
  const { cells } = scan(xml);
  const tables: string[][][] = [];
  for (const cell of cells) {
    const table = tables[cell.table] ?? [];
    tables[cell.table] = table;
    const row = table[cell.row] ?? [];
    table[cell.row] = row;
    row[cell.cell] = plainText(xml.slice(cell.innerStart, cell.innerEnd));
  }
  return tables;
}

function cellRange(xml: string, table: number, row: number, cell: number): CellRange {
  const found = scan(xml).cells.find((item) => item.table === table && item.row === row && item.cell === cell);
  if (!found) throw new Error(`No cell at table ${table}, row ${row}, cell ${cell}.`);
  return found;
}

export function cellPlainText(xml: string, table: number, row: number, cell: number): string {
  const range = cellRange(xml, table, row, cell);
  return plainText(xml.slice(range.innerStart, range.innerEnd));
}

export function plainText(xml: string): string {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) =>
      match[1]!
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"'),
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function setCellText(xml: string, table: number, row: number, cell: number, text: string): string {
  const range = cellRange(xml, table, row, cell);
  const inner = xml.slice(range.innerStart, range.innerEnd);
  return xml.slice(0, range.innerStart) + rewriteFirstParagraph(inner, text) + xml.slice(range.innerEnd);
}

function rewriteFirstParagraph(inner: string, text: string): string {
  const open = inner.indexOf("<w:p");
  const close = inner.indexOf("</w:p>");
  const paragraph = paragraphXml(text, "");
  if (open < 0 || close < 0) return `${paragraph}${inner}`;
  const current = inner.slice(open, close + "</w:p>".length);
  const pPr = current.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
  const rPr = current.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
  const rebuilt = `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  return inner.slice(0, open) + rebuilt + inner.slice(close + "</w:p>".length);
}

export function paragraphXml(text: string, rPr = ""): string {
  const fonts =
    rPr ||
    `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>`;
  return `<w:p><w:r>${fonts}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function deleteTableRow(xml: string, table: number, row: number): string {
  const found = scan(xml).rows.find((item) => item.table === table && item.row === row);
  if (!found) throw new Error(`No row at table ${table}, row ${row}.`);
  return xml.slice(0, found.start) + xml.slice(found.end);
}

/** Replace non-overlapping occurrences of `find` with the next string in `replacements`. */
export function replaceSequential(xml: string, find: string, replacements: string[]): string {
  const parts = xml.split(find);
  const found = parts.length - 1;
  if (found !== replacements.length) {
    throw new Error(`Expected ${replacements.length} of “${find}”, found ${found}.`);
  }
  let out = parts[0] ?? "";
  for (let index = 0; index < replacements.length; index += 1) {
    out += replacements[index] + (parts[index + 1] ?? "");
  }
  return out;
}

export function replaceTextNode(xml: string, from: string, to: string): string {
  const pattern = new RegExp(`(<w:t(?: [^>]*)?>)${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(</w:t>)`);
  if (!pattern.test(xml)) throw new Error(`Text node “${from}” was not found.`);
  return xml.replace(pattern, `$1${escapeXml(to)}$2`);
}

export function appendFooterLine(xml: string, text: string): string {
  const line = paragraphXml(text, `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>`);
  const end = xml.lastIndexOf("</w:ftr>");
  if (end < 0) return xml;
  return xml.slice(0, end) + line + xml.slice(end);
}

export function replaceBody(xml: string, inner: string): string {
  const start = xml.indexOf("<w:body>");
  const sect = xml.lastIndexOf("<w:sectPr");
  const end = xml.lastIndexOf("</w:body>");
  if (start < 0 || sect < 0 || end < 0) throw new Error("The document has no body.");
  return `${xml.slice(0, start + "<w:body>".length)}${inner}${xml.slice(sect, end)}${xml.slice(end)}`;
}

export function borderedCell(text: string, width: number): string {
  const borders = ["top", "left", "bottom", "right"]
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders>${borders}</w:tcBorders></w:tcPr>${paragraphXml(text)}</w:tc>`;
}

export function borderedRow(cells: string[]): string {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

export function borderedTable(rows: string[]): string {
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr>${rows.join("")}</w:tbl>`;
}

/** Replaces the first `from` inside one text node of a table cell, keeping the cell's other text and formatting. */
export function replaceInCell(xml: string, table: number, row: number, cell: number, from: string, to: string): string {
  const range = cellRange(xml, table, row, cell);
  const inner = xml.slice(range.innerStart, range.innerEnd);
  const needle = escapeXml(from);
  const node = /(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  let match: RegExpExecArray | null;
  while ((match = node.exec(inner))) {
    const at = match[2]!.indexOf(needle);
    if (at < 0) continue;
    const text = match[2]!.slice(0, at) + escapeXml(to) + match[2]!.slice(at + needle.length);
    const rebuilt = `<w:t xml:space="preserve">${text}</w:t>`;
    const next = inner.slice(0, match.index) + rebuilt + inner.slice(match.index + match[0].length);
    return xml.slice(0, range.innerStart) + next + xml.slice(range.innerEnd);
  }
  throw new Error(`“${from}” was not found in table ${table}, row ${row}, cell ${cell}.`);
}

/**
 * Replaces every `from` in the document text, even where Word split it across runs. The
 * replacement goes into the run where the match starts; the rest of the match is removed from
 * the following runs, which keep their own formatting.
 */
export function replaceAcrossRuns(xml: string, from: string, to: string): string {
  const needle = escapeXml(from);
  let out = xml;
  let replaced = 0;
  let searchFrom = 0;
  for (;;) {
    const nodes = [...out.matchAll(/(<w:t(?: [^>]*)?>)([\s\S]*?)(<\/w:t>)/g)];
    const owner: number[] = [];
    let text = "";
    nodes.forEach((node, index) => {
      text += node[2]!;
      for (let k = 0; k < node[2]!.length; k += 1) owner.push(index);
    });
    const at = text.indexOf(needle, searchFrom);
    if (at < 0) break;
    const end = at + needle.length;
    const starts: number[] = [];
    let offset = 0;
    for (const node of nodes) {
      starts.push(offset);
      offset += node[2]!.length;
    }
    const first = owner[at]!;
    const last = owner[end - 1]!;
    const contents = nodes.map((node) => node[2]!);
    for (let index = first; index <= last; index += 1) {
      const body = contents[index]!;
      const from0 = Math.max(at - starts[index]!, 0);
      const to0 = Math.min(end - starts[index]!, body.length);
      contents[index] = body.slice(0, from0) + (index === first ? escapeXml(to) : "") + body.slice(to0);
    }
    let rebuilt = "";
    let cursor = 0;
    nodes.forEach((node, index) => {
      rebuilt += out.slice(cursor, node.index);
      rebuilt += index >= first && index <= last ? `<w:t xml:space="preserve">${contents[index]}</w:t>` : node[0];
      cursor = node.index! + node[0].length;
    });
    out = rebuilt + out.slice(cursor);
    searchFrom = at + escapeXml(to).length;
    replaced += 1;
    if (replaced > 200) throw new Error(`Too many matches of “${from}”.`);
  }
  if (replaced === 0) throw new Error(`“${from}” was not found.`);
  return out;
}
