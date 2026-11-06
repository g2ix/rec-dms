import { eachField, type FormField, type FormSchema } from "@/lib/forms/schema";

export type RosterMember = {
  userId: string | null;
  role: string;
  isLeader: boolean;
  rosterOrder: number;
  status: string;
  displayName: string;
};

export type SignatureSlot = {
  fieldId: string;
  fieldPath: string;
  label: string;
  required: boolean;
  role: string;
  userId: string | null;
  displayName: string | null;
  status: string | null;
};

const OPEN = new Set(["ACTIVE", "INVITED"]);

export type SlotOptions = { assigneeUserId?: string | null };

const REVIEWER_ROLES = new Set(["PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT", "REVIEWER"]);

export function signatureSlots(schema: FormSchema, members: RosterMember[], options?: SlotOptions): SignatureSlot[] {
  const open = members
    .filter((member) => OPEN.has(member.status))
    .sort((a, b) => a.rosterOrder - b.rosterOrder || a.displayName.localeCompare(b.displayName));
  const slots: SignatureSlot[] = [];
  for (const field of eachField(schema)) {
    if (field.type !== "signature" || !field.signer) continue;
    slots.push(...slotsFor(field, open, options));
  }
  return slots;
}

function slotsFor(field: FormField, members: RosterMember[], options?: SlotOptions): SignatureSlot[] {
  const signer = field.signer;
  if (!signer) return [];
  const required = field.validation?.required === true;
  if (signer.each === "researchers") {
    const researchers = members.filter((member) => member.role === "PROPONENT");
    if (researchers.length === 0) {
      return [emptySlot(field, required)];
    }
    return researchers.map((member, index) => ({
      fieldId: field.id,
      fieldPath: `${field.id}.researchers[${index}]`,
      label: member.displayName,
      required,
      role: "PROPONENT",
      userId: member.userId,
      displayName: member.displayName,
      status: member.status,
    }));
  }

  if (options?.assigneeUserId && REVIEWER_ROLES.has(signer.role)) {
    const assignee = members.find((member) => member.userId === options.assigneeUserId && REVIEWER_ROLES.has(member.role));
    if (assignee) {
      return [
        {
          fieldId: field.id,
          fieldPath: field.id,
          label: field.label,
          required,
          role: signer.role,
          userId: assignee.userId,
          displayName: assignee.displayName,
          status: assignee.status,
        },
      ];
    }
  }

  const match =
    signer.role === "PROJECT_LEADER"
      ? members.find((member) => member.isLeader)
      : members.find((member) => member.role === signer.role);
  if (!match) {
    return [emptySlot(field, required)];
  }
  return [
    {
      fieldId: field.id,
      fieldPath: field.id,
      label: field.label,
      required,
      role: signer.role,
      userId: match.userId,
      displayName: match.displayName,
      status: match.status,
    },
  ];
}

function emptySlot(field: FormField, required: boolean): SignatureSlot {
  return {
    fieldId: field.id,
    fieldPath: field.id,
    label: field.label,
    required,
    role: field.signer?.role ?? "",
    userId: null,
    displayName: null,
    status: null,
  };
}

export type SignatureMark = { fieldPath: string; voidedAt: Date | null };

export function missingRequiredSignatures(
  schema: FormSchema,
  members: RosterMember[],
  events: SignatureMark[],
  options?: SlotOptions,
): SignatureSlot[] {
  const signed = new Set(events.filter((event) => event.voidedAt == null).map((event) => event.fieldPath));
  return signatureSlots(schema, members, options).filter((slot) => slot.required && !signed.has(slot.fieldPath));
}

/**
 * The field's fillers must include a role the person holds, and the person must be
 * the member that slot names.
 */
const OFFICE_ROLES = new Set(["REC_STAFF", "REC_CHAIR", "PANEL_CHAIR", "MEMBER_SECRETARY", "REC_MEMBER", "SYSTEM_ADMIN"]);

export function canSignSlot(
  field: FormField,
  slot: SignatureSlot,
  actor: { userId: string; roles: string[] },
): boolean {
  if (slot.userId) {
    if (slot.userId !== actor.userId || slot.status !== "ACTIVE") return false;
  } else {
    const fillers = field.fillers ?? [];
    const officeFiller = fillers.some((role) => OFFICE_ROLES.has(role) && actor.roles.includes(role));
    const slotMatch = OFFICE_ROLES.has(slot.role) && actor.roles.includes(slot.role);
    if (!officeFiller && !slotMatch) return false;
  }
  const fillers = field.fillers ?? [];
  if (fillers.length === 0) return actor.roles.includes(slot.role);
  return fillers.some((role) => actor.roles.includes(role));
}

export function slotByPath(
  schema: FormSchema,
  members: RosterMember[],
  fieldPath: string,
  options?: SlotOptions,
): { field: FormField; slot: SignatureSlot } | null {
  for (const field of eachField(schema)) {
    if (field.type !== "signature") continue;
    const slot = signatureSlots({ sections: [{ id: "one", title: "One", fields: [field] }] }, members, options).find(
      (item) => item.fieldPath === fieldPath,
    );
    if (slot) return { field, slot };
  }
  return null;
}
