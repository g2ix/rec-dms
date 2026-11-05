import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTokenFiles } from "../src/lib/tokens-check.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = checkTokenFiles(root);

if (errors.length > 0) {
  console.error("src/styles/tokens.css does not match docs/design/tokens.json:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("tokens.css matches tokens.json");
