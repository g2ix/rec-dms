import "server-only";
import type { Prisma, StoredFile } from "@prisma/client";
import { validateSchema } from "@/lib/forms/schema";
import { onProponentSide } from "@/lib/workflow/blinding";
import { parseGraph } from "@/lib/workflow/graph";
import { reviewFormCodes } from "@/lib/workflow/review-stage";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { AppError } from "@/server/errors";
import { usesIntake } from "@/server/intake/state";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The review forms a proponent or adviser may open once their round is released, and only as the
 * release copy made for them. F-37 and F-39 are the round-1 result; F-38 (its redacted release copy)
 * is the result of later rounds; F-40 and F-42 are the certificates. REC can change the list on
 * /admin/settings without code.
 */
export const RELEASED_FORMS_KEY = "revision.releasedForms";
export const DEFAULT_RELEASED_FORMS = ["F-37", "F-38", "F-39", "F-40", "F-42"] as const;

export async function releasedFormCodes(db: Db = prisma): Promise<string[]> {
  const value = await settingValue(db, RELEASED_FORMS_KEY);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
  return [...DEFAULT_RELEASED_FORMS];
}

/**
 * What one viewer may do with one form copy.
 * - full: committee members and reviewers, as before.
 * - legacy: a proponent on a protocol on the 2025 forms (09-01 / 10-01); the earlier rules apply.
 * - own: the proponents' own copy, shown and printed without the columns hidden from their roles.
 * - released: only the release copies made for the proponents.
 * - denied: refused (403), on the page, the document route, previews, file downloads and packages.
 */
export type FormAccess =
  | { kind: "full" }
  | { kind: "legacy" }
  | { kind: "own" }
  | { kind: "released"; files: StoredFile[] }
  | { kind: "denied" };

export async function isProponentSide(db: Db, userId: string, protocolId: string): Promise<boolean> {
  const members = await db.protocolMember.findMany({ where: { protocolId }, select: { userId: true, role: true, status: true } });
  return onProponentSide(members, userId);
}

/** Form codes the committee works on during review, read from every workflow this protocol ran. */
export async function protocolReviewForms(db: Db, protocolId: string): Promise<Set<string>> {
  const instances = await db.workflowInstance.findMany({ where: { protocolId }, select: { version: { select: { graph: true } } } });
  const codes = new Set<string>();
  for (const instance of instances) {
    const parsed = parseGraph(instance.version.graph);
    if (!parsed.ok) continue;
    for (const code of reviewFormCodes(parsed.graph)) codes.add(code);
  }
  return codes;
}

export async function formAccess(db: Db, userId: string, instanceId: string): Promise<FormAccess> {
  const instance = await db.formInstance.findUnique({
    where: { id: instanceId },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      filledByMemberId: true,
      formDefinition: { select: { code: true, schema: true } },
    },
  });
  if (!instance || instance.ownerType !== "PROTOCOL_VERSION") return { kind: "full" };
  const version = await db.protocolVersion.findUnique({ where: { id: instance.ownerId }, select: { id: true, state: true, protocolId: true } });
  if (!version) return { kind: "full" };
  const members = await db.protocolMember.findMany({
    where: { protocolId: version.protocolId },
    select: { id: true, userId: true, role: true, status: true },
  });
  if (!onProponentSide(members, userId)) return { kind: "full" };
  if (!(await usesIntake(db, version.id))) return { kind: "legacy" };

  // A reviewer's own copy (one per reviewer slot) is never the proponents' to open.
  if (instance.filledByMemberId) {
    const filler = members.find((member) => member.id === instance.filledByMemberId);
    if (!filler || (filler.role !== "PROPONENT" && filler.role !== "ADVISER")) return { kind: "denied" };
  }
  const code = instance.formDefinition.code;
  const check = validateSchema(instance.formDefinition.schema);
  const intakeSourced = check.ok && check.schema.source === "intake";
  // The version the proponents are preparing (first draft, or reopened after a return).
  if (version.state === "WORKING" && intakeSourced) return { kind: "own" };

  const released = await releasedFormCodes(db);
  if (released.includes(code)) {
    const files = await db.storedFile.findMany({
      where: { formInstanceId: instance.id, audience: "PROPONENT" },
      orderBy: { createdAt: "desc" },
    });
    return files.length > 0 ? { kind: "released", files } : { kind: "denied" };
  }
  if ((await protocolReviewForms(db, version.protocolId)).has(code)) return { kind: "denied" };
  return { kind: "own" };
}

export const NOT_RELEASED_MESSAGE = "This form is not available to you.";

/** formAccess, refusing with 403 when denied. */
export async function requireFormAccess(db: Db, userId: string, instanceId: string): Promise<Exclude<FormAccess, { kind: "denied" }>> {
  const access = await formAccess(db, userId, instanceId);
  if (access.kind === "denied") throw new AppError("FORBIDDEN", NOT_RELEASED_MESSAGE, 403);
  return access;
}

/** The release copy in the asked format, if there is one. */
export function releasedFile(access: { files: StoredFile[] }, format: "docx" | "pdf"): StoredFile | null {
  const kind = format === "pdf" ? "GENERATED_PDF" : "GENERATED_DOCX";
  return access.files.find((file) => file.kind === kind) ?? null;
}

/**
 * Whether a proponent-side viewer may download this stored file. Uploads (no form) keep their own
 * rules; a generated form file follows the form's access: its release copy, or the proponent-view
 * render of their own copy.
 */
export async function fileAccessAllowed(db: Db, userId: string, file: { formInstanceId: string | null; audience: string | null; variant: string | null }): Promise<boolean> {
  if (!file.formInstanceId) return true;
  const access = await formAccess(db, userId, file.formInstanceId);
  if (access.kind === "full" || access.kind === "legacy") return true;
  if (access.kind === "denied") return false;
  if (access.kind === "released") return file.audience === "PROPONENT";
  return file.variant === "proponent-view";
}
