import "server-only";
import { findField, type FormSchema } from "@/lib/forms/schema";
import { ROLE_KEY_LABEL, isRoleKey } from "@/lib/forms/roles";
import { canSignSlot, signatureSlots } from "@/lib/signatures/target";
import type { SignatureSlotView } from "@/lib/signatures/view";
import { formatSignatureTime } from "@/lib/time";
import { prisma } from "@/server/db";
import { toRoster } from "@/server/signatures/sign";
import { getObjectBytes } from "@/server/storage";
import { contactEmail, signingStepUpFresh } from "@/server/stepup";

export type SignaturePanel = {
  byField: Record<string, SignatureSlotView[]>;
  hasPassword: boolean;
  fresh: boolean;
  email: string | null;
};

function waitingFor(role: string, name: string | null): string {
  if (name) return `Waiting for ${name}`;
  if (role === "ADVISER") return "Waiting for an adviser";
  if (role === "PROPONENT") return "Waiting for a proponent";
  return `Waiting for ${isRoleKey(role) ? ROLE_KEY_LABEL[role] : "a signature"}`;
}

async function imageDataUrl(storageKey: string, cache: Map<string, string | null>): Promise<string | null> {
  const cached = cache.get(storageKey);
  if (cached !== undefined) return cached;
  try {
    const object = await getObjectBytes(storageKey);
    const mime = object.contentType?.startsWith("image/") ? object.contentType : "image/png";
    const url = `data:${mime};base64,${Buffer.from(object.body).toString("base64")}`;
    cache.set(storageKey, url);
    return url;
  } catch {
    cache.set(storageKey, null);
    return null;
  }
}

export async function loadSignaturePanel(input: {
  userId: string;
  hasPassword: boolean;
  protocolId: string;
  instanceId: string;
  schema: FormSchema;
  roles: string[];
}): Promise<SignaturePanel> {
  const [memberRows, events, fresh, email] = await Promise.all([
    prisma.protocolMember.findMany({
      where: { protocolId: input.protocolId, status: { in: ["ACTIVE", "INVITED"] } },
      include: { user: { select: { displayName: true } } },
    }),
    prisma.signatureEvent.findMany({
      where: { formInstanceId: input.instanceId },
      include: { user: { select: { displayName: true } }, signature: true },
      orderBy: { signedAt: "desc" },
    }),
    signingStepUpFresh(input.userId),
    contactEmail(input.userId),
  ]);
  const roster = toRoster(memberRows);
  const latest = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    if (!latest.has(event.fieldPath)) latest.set(event.fieldPath, event);
  }
  const images = new Map<string, string | null>();
  const byField: Record<string, SignatureSlotView[]> = {};
  for (const slot of signatureSlots(input.schema, roster)) {
    const field = findField(input.schema, slot.fieldId);
    if (!field) continue;
    const event = latest.get(slot.fieldPath) ?? null;
    const status = !event ? "unsigned" : event.voidedAt ? "void" : "signed";
    const canSign = Boolean(field) && canSignSlot(field, slot, { userId: input.userId, roles: input.roles }) && status !== "signed";
    const view: SignatureSlotView = {
      fieldPath: slot.fieldPath,
      label: slot.label,
      required: slot.required,
      canSign,
      waiting: status === "unsigned" ? waitingFor(slot.role, slot.displayName) : null,
      status,
      signerName: event?.user.displayName ?? null,
      signedAtLabel: event ? formatSignatureTime(event.signedAt) : null,
      verifyRef: event?.verifyRef ?? null,
      imageDataUrl: event ? await imageDataUrl(event.signature.imageKey, images) : null,
    };
    const list = byField[slot.fieldId] ?? [];
    list.push(view);
    byField[slot.fieldId] = list;
  }
  return { byField, hasPassword: input.hasPassword, fresh, email };
}
