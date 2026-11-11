"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ImportRow } from "@/lib/panels/import";
import { actionFailure } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { applyImport, parseWorkbook, planImport, type PlanItem } from "@/server/users/panel-import";
import { requireUser } from "@/server/session";

const MAX_BYTES = 5 * 1024 * 1024;

export async function previewPanelImportAction(
  formData: FormData,
): Promise<{ ok: true; rows: ImportRow[]; plan: PlanItem[] } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "users.manage");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the members spreadsheet." };
    if (file.size > MAX_BYTES) return { ok: false, error: "That file is larger than 5 MB." };
    const parsed = await parseWorkbook(new Uint8Array(await file.arrayBuffer()));
    return { ok: true, rows: parsed.rows, plan: await planImport(prisma, parsed.rows, parsed.skipped) };
  } catch (error) {
    return actionFailure(error, "The spreadsheet could not be read.");
  }
}

const rowShape = z.object({
  sheetRow: z.number().int(),
  panelCode: z.string().min(1),
  panelName: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().nullable(),
  extraEmail: z.string().email().nullable(),
  roleKey: z.string().min(1),
  attributes: z.object({
    designation: z.string(),
    isScientist: z.boolean().nullable(),
    discipline: z.string(),
    affiliate: z.boolean().nullable(),
    alternate: z.boolean(),
  }),
});

export async function applyPanelImportAction(
  input: unknown,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "users.manage");
    const rows = z.array(rowShape).max(500).parse(input);
    const counts = await applyImport({ rows, actorUserId: user.id });
    revalidatePath("/admin/panels");
    return {
      ok: true,
      summary: `Imported. ${counts.panels} panels created, ${counts.accounts} accounts created, ${counts.granted} roles granted, ${counts.changed} changed, ${counts.removed} removed.`,
    };
  } catch (error) {
    return actionFailure(error, "The import could not be applied.");
  }
}
