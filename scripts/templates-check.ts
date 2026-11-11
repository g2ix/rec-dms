import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PizZip from "pizzip";
import { uscForms, type UscForm } from "../prisma/seed/usc-rec/forms";
import { uscForms2026 } from "../prisma/seed/usc-rec/forms-2026-11";
import { checkPlaceholderMap, placeholderMapSchema, tagsFromDocumentXml } from "../src/lib/docs/tags";
import type { FormSchema } from "../src/lib/forms/schema";

const root = process.cwd();
let failed = false;

/** Each template set is checked against the form versions it belongs to. */
const sets: { label: string; dir: string; forms: UscForm[] }[] = [
  { label: "2025", dir: join(root, "templates"), forms: uscForms },
  { label: "2026-11", dir: join(root, "templates", "2026-11"), forms: uscForms2026 },
];

for (const set of sets) {
  const maps = join(set.dir, "maps");
  if (!existsSync(maps)) continue;
  for (const file of readdirSync(maps).filter((name) => name.endsWith(".json"))) {
    const code = file.replace(/\.json$/, "");
    const form = set.forms.find((item) => item.code === code);
    if (!form) {
      console.error(`${set.label} ${code} has a map but no seeded form`);
      failed = true;
      continue;
    }
    const zip = new PizZip(readFileSync(join(set.dir, `${code}.docx`)));
    const tags = tagsFromDocumentXml(
      Object.values(zip.files)
        .filter((part) => !part.dir)
        .map((part) => ({ name: part.name, xml: part.asText() })),
    );
    const map = placeholderMapSchema.parse(JSON.parse(readFileSync(join(maps, file), "utf8")));
    const check = checkPlaceholderMap({ tags, map, schema: form.schema as FormSchema });
    if (check.unmappedTags.length > 0 || check.unmappedFields.length > 0) {
      failed = true;
      console.error(set.label, code, check);
    } else {
      console.log(`${set.label} ${code} ok`);
    }
  }
  const missing = set.forms.filter((form) => !existsSync(join(maps, `${form.code}.json`))).map((form) => form.code);
  if (set.label === "2026-11" && missing.length > 0) {
    failed = true;
    console.error(`2026-11 forms without a template: ${missing.join(", ")}`);
  }
}

if (failed) process.exit(1);
console.log("templates check passed");
