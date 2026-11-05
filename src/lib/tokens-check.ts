import { readFileSync } from "node:fs";
import path from "node:path";

type ThemeValue = { light: string; dark: string };
type ColorToken = { name: string; value: string | ThemeValue };
type Named = { name: string; value: string };
type TypeStyle = {
  name: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
};
type TypeGroup = { name: string; family: string; styles: TypeStyle[] };

export type TokenSpec = {
  color: { tokens: ColorToken[] };
  type: { families: Record<string, string>; groups: TypeGroup[] };
  spacing: { tokens: Named[] };
  radius: { tokens: Named[] };
  shadow: { tokens: { name: string; value: string | ThemeValue }[] };
  duration: { tokens: Named[] };
  easing: { tokens: Named[] };
  blur: { tokens: Named[] };
  size: { tokens: Named[] };
};

function norm(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function blockAfter(css: string, header: RegExp): string {
  const match = header.exec(css);
  if (!match || match.index === undefined) {
    throw new Error(`Missing CSS block ${header}`);
  }
  const start = css.indexOf("{", match.index);
  if (start < 0) throw new Error(`Missing brace for ${header}`);
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  throw new Error(`Unclosed block ${header}`);
}

function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of block.split(";")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name.startsWith("--") && value) map.set(name, value);
  }
  return map;
}

function classBlocks(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /\.([a-z0-9-]+)\s*\{([^}]+)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    map.set(match[1], match[2]);
  }
  return map;
}

function prop(block: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+)`);
  return re.exec(block)?.[1]?.trim();
}

function expectDecl(
  errors: string[],
  decls: Map<string, string>,
  name: string,
  value: string,
  where: string,
) {
  const actual = decls.get(name);
  if (actual === undefined) {
    errors.push(`${where} is missing ${name}`);
    return;
  }
  if (norm(actual) !== norm(value)) {
    errors.push(`${where} ${name} is ${actual}, expected ${value}`);
  }
}

export function compareTokens(css: string, spec: TokenSpec): string[] {
  const errors: string[] = [];
  const light = declarations(blockAfter(css, /:root,\s*\[data-theme="light"\]/));
  const dark = declarations(blockAfter(css, /\[data-theme="dark"\]/));
  const rootCss = css.replace(/:root,\s*\[data-theme="light"\][\s\S]*?\n\}/, "");
  const root = declarations(blockAfter(rootCss, /:root/));
  const classes = classBlocks(css);

  const lightNames = new Set<string>();
  const darkNames = new Set<string>();

  for (const token of spec.color.tokens) {
    const name = `--${token.name}`;
    if (typeof token.value === "string") {
      expectDecl(errors, light, name, token.value, "light");
      lightNames.add(name);
      const darkValue = dark.get(name);
      if (darkValue !== undefined && norm(darkValue) !== norm(token.value)) {
        errors.push(`dark ${name} is ${darkValue}, expected ${token.value}`);
      }
    } else {
      expectDecl(errors, light, name, token.value.light, "light");
      expectDecl(errors, dark, name, token.value.dark, "dark");
      lightNames.add(name);
      darkNames.add(name);
    }
  }

  for (const token of spec.shadow.tokens) {
    const name = `--${token.name}`;
    if (typeof token.value === "string") {
      expectDecl(errors, light, name, token.value, "light");
      lightNames.add(name);
    } else {
      expectDecl(errors, light, name, token.value.light, "light");
      expectDecl(errors, dark, name, token.value.dark, "dark");
      lightNames.add(name);
      darkNames.add(name);
    }
  }

  for (const [name] of light) {
    if (!lightNames.has(name)) errors.push(`light has extra ${name}`);
  }
  for (const [name] of dark) {
    if (!darkNames.has(name) && !lightNames.has(name)) errors.push(`dark has extra ${name}`);
  }

  const rootExpected = new Map<string, string>();
  const groups: Named[][] = [
    spec.spacing.tokens,
    spec.radius.tokens,
    spec.duration.tokens,
    spec.easing.tokens,
    spec.blur.tokens,
    spec.size.tokens,
  ];
  for (const group of groups) {
    for (const token of group) rootExpected.set(`--${token.name}`, token.value);
  }
  for (const [family, stack] of Object.entries(spec.type.families)) {
    rootExpected.set(`--font-${family}`, stack);
  }
  for (const [name, value] of rootExpected) expectDecl(errors, root, name, value, ":root");
  for (const [name] of root) {
    if (!rootExpected.has(name)) errors.push(`:root has extra ${name}`);
  }

  const styleNames = new Set<string>();
  for (const group of spec.type.groups) {
    for (const style of group.styles) {
      styleNames.add(style.name);
      const block = classes.get(style.name);
      if (!block) {
        errors.push(`missing type class .${style.name}`);
        continue;
      }
      const family = prop(block, "font-family");
      const expectedFamily = `var(--font-${group.family})`;
      if (!family || norm(family) !== norm(expectedFamily)) {
        errors.push(`.${style.name} font-family is ${family}, expected ${expectedFamily}`);
      }
      for (const [key, expected] of [
        ["font-size", style.fontSize],
        ["line-height", style.lineHeight],
        ["font-weight", String(style.fontWeight)],
      ] as const) {
        const actual = prop(block, key);
        if (!actual || norm(actual) !== norm(expected)) {
          errors.push(`.${style.name} ${key} is ${actual}, expected ${expected}`);
        }
      }
      if (style.letterSpacing) {
        const actual = prop(block, "letter-spacing");
        if (!actual || norm(actual) !== norm(style.letterSpacing)) {
          errors.push(`.${style.name} letter-spacing is ${actual}, expected ${style.letterSpacing}`);
        }
      }
    }
  }
  for (const name of classes.keys()) {
    if (!styleNames.has(name)) errors.push(`extra type class .${name}`);
  }

  return errors;
}

export function checkTokenFiles(rootDir: string): string[] {
  const css = readFileSync(path.join(rootDir, "src/styles/tokens.css"), "utf8");
  const spec = JSON.parse(readFileSync(path.join(rootDir, "docs/design/tokens.json"), "utf8")) as TokenSpec;
  return compareTokens(css, spec);
}
