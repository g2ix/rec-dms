"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FEE_BASES } from "@/lib/fees/calc";
import { centavosFromPesos } from "@/lib/forms/money";
import { actionFailure, type ActionState } from "@/server/action-state";
import { authorize } from "@/server/authz";
import { decideBill } from "@/server/fees/bills";
import { setClientType } from "@/server/fees/client-type";
import { previewFee, saveClientType, saveSchedule } from "@/server/fees/schedules";
import { requireUser } from "@/server/session";

function fail(error: unknown, fallback: string): { ok: false; error: string } {
  return actionFailure(error, fallback);
}

export async function setClientTypeAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const protocolId = z.string().uuid().parse(formData.get("protocolId"));
  await authorize(user, "protocol.fee", { type: "protocol", id: protocolId });
  const key = String(formData.get("clientTypeKey") ?? "").trim() || null;
  await setClientType({ protocolId, clientTypeKey: key, actorUserId: user.id });
  revalidatePath(`/app/protocols/${protocolId}`);
}

export async function decideBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    const protocolId = z.string().uuid().parse(formData.get("protocolId"));
    await authorize(user, "protocol.fee", { type: "protocol", id: protocolId });
    const decision = z.enum(["VERIFIED", "REJECTED", "PARTIAL"]).parse(formData.get("decision"));
    const paid = String(formData.get("amountPaid") ?? "").trim();
    await decideBill({
      billId: z.string().uuid().parse(formData.get("billId")),
      actorUserId: user.id,
      decision,
      amountPaid: paid ? centavosFromPesos(paid) : null,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath("/app/receipts");
    revalidatePath(`/app/protocols/${protocolId}`);
    return null;
  } catch (error) {
    return actionFailure(error, "The payment could not be recorded.");
  }
}

export async function saveClientTypeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await requireUser();
    await authorize(user, "fees.manage");
    await saveClientType({
      key: z.string().trim().min(1, "Give the client type a key.").parse(formData.get("key")),
      label: z.string().trim().min(1, "Give the client type a label.").parse(formData.get("label")),
      active: formData.get("active") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0) || 0,
      actorUserId: user.id,
    });
    revalidatePath("/admin/fees");
    return null;
  } catch (error) {
    return fail(error, "The client type could not be saved.");
  }
}

const scheduleShape = z.object({
  id: z.string().uuid().nullish(),
  effectiveFrom: z.string(),
  approvedRef: z.string().default(""),
  notes: z.string().default(""),
  rates: z.array(z.object({ clientTypeKey: z.string().min(1), basis: z.enum(FEE_BASES), amount: z.number().int().min(0) })),
  rules: z.array(z.object({ key: z.string().min(1), label: z.string().default(""), percent: z.number().int(), fromRound: z.number().int().nullable() })),
});

export async function saveScheduleAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "fees.manage");
    const parsed = scheduleShape.parse(input);
    const id = await saveSchedule({ ...parsed, actorUserId: user.id });
    revalidatePath("/admin/fees");
    return { ok: true, id };
  } catch (error) {
    return { ok: false, message: fail(error, "The schedule could not be saved.").error };
  }
}

export async function previewFeeAction(input: unknown): Promise<{ ok: true; amount: number | null; scheduleFrom: string | null; note: string } | { ok: false; message: string }> {
  try {
    const user = await requireUser();
    await authorize(user, "fees.manage");
    const parsed = z
      .object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), clientTypeKey: z.string(), reviewType: z.string(), basis: z.string(), round: z.number().int().min(1) })
      .parse(input);
    const { schedule, quote } = await previewFee(parsed);
    return {
      ok: true,
      amount: quote?.amount ?? null,
      scheduleFrom: schedule ? schedule.effectiveFrom.toISOString().slice(0, 10) : null,
      note: !schedule ? "No schedule is in effect on that date." : !quote ? "Nothing to bill: no rate, or the rule does not apply to this round." : quote.rule ? `${quote.rule.percent}% of the base rate` : "Base rate",
    };
  } catch (error) {
    return { ok: false, message: fail(error, "The preview failed.").error };
  }
}
