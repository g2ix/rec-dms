import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export const REQUIRED_FORMS_KEY = "protocol.requiredForms";
export const REQUIRED_UPLOADS_KEY = "protocol.requiredUploads";
export const MAX_UPLOAD_KEY = "uploads.maxBytes";

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_REQUIRED_UPLOADS = ["MANUSCRIPT", "COVER_LETTER", "FEE_RECEIPT"] as const;

type Db = Prisma.TransactionClient | typeof prisma;

async function readValue(db: Db, key: string): Promise<unknown> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value;
}

export async function requiredFormCodes(db: Db = prisma): Promise<string[]> {
  const value = await readValue(db, REQUIRED_FORMS_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function requiredUploadKinds(db: Db = prisma): Promise<string[]> {
  const value = await readValue(db, REQUIRED_UPLOADS_KEY);
  if (!Array.isArray(value)) return [...DEFAULT_REQUIRED_UPLOADS];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export async function maxUploadBytes(db: Db = prisma): Promise<number> {
  const value = await readValue(db, MAX_UPLOAD_KEY);
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  return DEFAULT_MAX_UPLOAD_BYTES;
}
