import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Pair = { fg: string; bg: string; min?: number };

function channel(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function lum(hex: string): number {
  const [r, g, b] = channel(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: string, bg: string): number {
  const a = lum(fg);
  const b = lum(bg);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const spec = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../docs/design/tokens.json"), "utf8"),
) as {
  color: { tokens: { name: string; value: string | { light: string; dark: string } }[] };
};

function color(name: string, theme: "light" | "dark"): string {
  const token = spec.color.tokens.find((item) => item.name === name);
  if (!token) throw new Error(`missing ${name}`);
  return typeof token.value === "string" ? token.value : token.value[theme];
}

const pairs: Pair[] = [
  { fg: "ink", bg: "bg" },
  { fg: "ink", bg: "surface" },
  { fg: "ink", bg: "surface-sunken" },
  { fg: "ink", bg: "surface-raised" },
  { fg: "ink-muted", bg: "bg" },
  { fg: "ink-muted", bg: "surface" },
  { fg: "ink-muted", bg: "surface-sunken" },
  { fg: "ink-muted", bg: "surface-raised" },
  { fg: "on-primary", bg: "primary" },
  { fg: "primary-ink", bg: "primary-soft" },
  { fg: "on-danger", bg: "danger" },
  { fg: "danger-ink", bg: "danger-soft" },
  { fg: "info-ink", bg: "info-soft" },
  { fg: "warning", bg: "warning-soft" },
  { fg: "primary", bg: "surface" },
  { fg: "danger", bg: "surface" },
  { fg: "info", bg: "surface" },
  { fg: "warning", bg: "surface" },
];

describe("token contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`keeps text pairs at 4.5:1 in ${theme}`, () => {
      const failures = pairs
        .map((pair) => {
          const fg = color(pair.fg, theme);
          const bg = color(pair.bg, theme);
          return { ...pair, fg, bg, ratio: ratio(fg, bg) };
        })
        .filter((pair) => pair.ratio < (pair.min ?? 4.5));
      expect(failures).toEqual([]);
    });
  }
});
