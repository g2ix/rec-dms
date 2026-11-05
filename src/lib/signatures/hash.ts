import { createHash } from "node:crypto";
import { canonicalJson } from "@/server/audit/hash";
import { eachField, type FormSchema } from "@/lib/forms/schema";

export function signatureFieldIds(schema: FormSchema): string[] {
  return eachField(schema)
    .filter((field) => field.type === "signature")
    .map((field) => field.id);
}

/** Form data with signature fields removed, so a signature never changes the hash it seals. */
export function dataWithoutSignatures(data: unknown, signatureIds: string[]): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const copy: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const id of signatureIds) delete copy[id];
  return copy;
}

export function formDataHash(data: unknown, signatureIds: string[]): string {
  return createHash("sha256").update(canonicalJson(dataWithoutSignatures(data, signatureIds))).digest("hex");
}
