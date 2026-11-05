export function centavosFromPesos(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return Number.NaN;
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", frac = ""] = unsigned.split(".");
  const centavos = Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
  return negative ? -centavos : centavos;
}

export function pesosInput(centavos: number): string {
  const negative = centavos < 0;
  const absolute = Math.abs(centavos);
  const whole = Math.trunc(absolute / 100);
  const frac = (absolute % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatCentavos(centavos: number): string {
  const negative = centavos < 0;
  const absolute = Math.abs(centavos);
  const whole = Math.trunc(absolute / 100).toLocaleString("en-PH");
  const frac = (absolute % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₱${whole}.${frac}`;
}
