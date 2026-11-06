import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { uscForms } from "../prisma/seed/usc-rec/forms";
import { checkPlaceholderMap, placeholderMapSchema, tagsFromDocumentXml } from "../src/lib/docs/tags";
import type { FormSchema } from "../src/lib/forms/schema";

const root = process.cwd();
const maps = join(root, "templates", "maps");
let failed = false;

for (const file of readdirSync(maps).filter((name) => name.endsWith(".json"))) {
  const code = file.replace(/\.json$/, "");
  const form = uscForms.find((item) => item.code === code);
  if (!form) {
    console.error(`${code} has a map but no seeded form`);
    failed = true;
    continue;
  }
  const zip = new PizZip(readFileSync(join(root, "templates", `${code}.docx`)));
  const tags = tagsFromDocumentXml(
    Object.values(zip.files)
      .filter((part) => !part.dir)
      .map((part) => ({ name: part.name, xml: part.asText() })),
  );
  const map = placeholderMapSchema.parse(JSON.parse(readFileSync(join(maps, file), "utf8")));
  const check = checkPlaceholderMap({ tags, map, schema: form.schema as FormSchema });
  if (check.unmappedTags.length > 0 || check.unmappedFields.length > 0) {
    failed = true;
    console.error(code, check);
  } else {
    console.log(`${code} ok`);
  }
}

if (failed) process.exit(1);
console.log("templates check passed");
