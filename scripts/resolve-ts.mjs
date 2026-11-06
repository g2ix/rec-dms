import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function aliasFile(specifier) {
  const base = join(srcRoot, specifier.slice(2));
  if (existsSync(`${base}.ts`)) return pathToFileURL(`${base}.ts`).href;
  if (existsSync(join(base, "index.ts"))) return pathToFileURL(join(base, "index.ts")).href;
  return pathToFileURL(base).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(aliasFile(specifier), context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !/\.(?:js|mjs|cjs|ts|json|node)$/.test(specifier)
  ) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
