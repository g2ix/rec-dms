import { z } from "zod";
import { eachField, type FormSchema } from "@/lib/forms/schema";
import { plainText } from "@/lib/docs/ooxml";

export const HELPERS = [
  "checkbox",
  "signature",
  "signedFooter",
  "join",
  "text",
  "choice",
  "date",
  "money",
  "rows",
  "assessmentRows",
  "budgetCell",
  "budgetRest",
  "budgetSum",
] as const;

const entryObject = z
  .object({
    path: z.string().min(1).optional(),
    helper: z.enum(HELPERS).optional(),
    equals: z.string().optional(),
    includes: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    columns: z.array(z.string().min(1)).optional(),
    covers: z.array(z.string().min(1)).optional(),
    slot: z.number().int().nonnegative().optional(),
    match: z.string().optional(),
    column: z.string().optional(),
    skip: z.array(z.string()).optional(),
    sections: z.array(z.string()).optional(),
    extraPaths: z.array(z.string()).optional(),
    onlyFilled: z.array(z.string()).optional(),
    index: z.number().int().nonnegative().optional(),
  })
  .strict();

export const placeholderEntrySchema = z.union([z.string().min(1), entryObject]);
export const placeholderMapSchema = z.record(z.string().min(1), placeholderEntrySchema);

export type PlaceholderEntry = z.infer<typeof placeholderEntrySchema>;
export type PlaceholderMap = z.infer<typeof placeholderMapSchema>;

export type DocTag = {
  name: string;
  kind: "value" | "image" | "loop";
  scope: string | null;
};

export function extractTags(xml: string): DocTag[] {
  const text = [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1] ?? "").join("");
  const tags: DocTag[] = [];
  const stack: string[] = [];
  const re = /\{(?:(#|\/)|(%))?([\w.]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const marker = match[1];
    const image = match[2] === "%";
    const name = match[3] ?? "";
    if (!name) continue;
    if (marker === "#") {
      tags.push({ name, kind: "loop", scope: stack.at(-1) ?? null });
      stack.push(name);
      continue;
    }
    if (marker === "/") {
      stack.pop();
      continue;
    }
    tags.push({ name, kind: image ? "image" : "value", scope: stack.at(-1) ?? null });
  }
  return tags;
}

export function tagsFromDocumentXml(parts: { name: string; xml: string }[]): DocTag[] {
  return parts
    .filter((part) => /word\/(document|footer\d+)\.xml$/.test(part.name))
    .flatMap((part) => extractTags(part.xml));
}

export type MapCheck = {
  unmappedTags: string[];
  unmappedFields: string[];
};

export function checkPlaceholderMap(input: { tags: DocTag[]; map: PlaceholderMap; schema: FormSchema }): MapCheck {
  const unmappedTags: string[] = [];
  for (const tag of input.tags) {
    if (tag.scope) {
      const loop = normalize(input.map[tag.scope]);
      const columns = loop?.columns ?? [];
      if (!columns.includes(tag.name) && !(tag.name in input.map)) {
        unmappedTags.push(`${tag.scope}.${tag.name}`);
      }
      continue;
    }
    if (!(tag.name in input.map)) unmappedTags.push(tag.name);
  }
  const referenced = referencedFields(input.map);
  const unmappedFields = eachField(input.schema)
    .map((field) => field.id)
    .filter((id) => !referenced.has(id));
  return { unmappedTags: unique(unmappedTags), unmappedFields };
}

function referencedFields(map: PlaceholderMap): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(map)) {
    const normalized = normalize(entry);
    if (!normalized) continue;
    if (normalized.path) ids.add(normalized.path.split(".")[0] ?? normalized.path);
    for (const id of normalized.covers ?? []) ids.add(id);
    for (const extra of normalized.extraPaths ?? []) ids.add(extra.split(".")[0] ?? extra);
  }
  return ids;
}

export function normalize(entry: PlaceholderEntry | undefined): z.infer<typeof entryObject> | null {
  if (!entry) return null;
  if (typeof entry === "string") return { path: entry, helper: "text" };
  return entry;
}

export function documentPlainText(xml: string): string {
  return plainText(xml);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
