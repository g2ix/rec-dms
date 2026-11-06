export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export function csvDocument(header: string[], rows: unknown[][]): string {
  return `\uFEFF${[csvLine(header), ...rows.map(csvLine)].join("\r\n")}\r\n`;
}
