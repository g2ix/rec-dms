import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkTokenFiles, compareTokens, type TokenSpec } from "./tokens-check";

const root = path.resolve(import.meta.dirname, "../..");

const spec = {
  color: { tokens: [{ name: "bg", value: { light: "#fff", dark: "#000" } }] },
  type: { families: { sans: "sans" }, groups: [] },
  spacing: { tokens: [] },
  radius: { tokens: [] },
  shadow: { tokens: [] },
  duration: { tokens: [] },
  easing: { tokens: [] },
  blur: { tokens: [] },
  size: { tokens: [] },
} as TokenSpec;

describe("tokens check", () => {
  it("accepts the design tokens copied into src", () => {
    expect(checkTokenFiles(root)).toEqual([]);
  });

  it("reports a drifted theme value", () => {
    const css = `:root, [data-theme="light"] {\n  --bg: #111;\n}\n[data-theme="dark"] {\n  --bg: #000;\n}\n:root {\n  --font-sans: sans;\n}\n`;
    expect(compareTokens(css, spec).join("\n")).toContain("expected #fff");
  });
});
