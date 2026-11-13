import "server-only";
import type { FormField, FormSchema } from "@/lib/forms/schema";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { railSections, missingOnPage, type RailSection } from "@/lib/intake/rail";
import type { ChecklistItem } from "@/lib/protocols/checklist";
import type { SignatureSlotView } from "@/lib/signatures/view";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { getSubmissionChecklist, proponentSubmitTarget } from "@/server/protocols/checklist";
import { formForEdit, listUploads, protocolHeader, roster } from "@/server/protocols/read";
import { loadSignaturePanel } from "@/server/signatures/views";

/** The forms the intake generates. Proponents preview and print them; they never edit them. */
export const GENERATED_FORMS = ["F-26", "F-27", "F-28", "F-30", "F-35", "F-36"] as const;

export type GeneratedForm = {
  instanceId: string;
  code: string;
  title: string;
  /** For the read-only preview. Proponents' roles hide the reviewer columns, as on the form page. */
  schema: FormSchema;
  data: Record<string, unknown>;
  roles: RoleKey[];
  boundValues: Record<string, unknown>;
};

export type SigningForm = {
  instanceId: string;
  code: string;
  title: string;
  fields: FormField[];
  slots: Record<string, SignatureSlotView[]>;
  signing: { instanceId: string; hasPassword: boolean; fresh: boolean; email: string | null };
};

export type GeneratedFormRow = { instanceId: string; code: string; title: string };

/** The generated forms of a version, for the preview list: one query. The preview itself loads on demand. */
export async function generatedFormList(versionId: string): Promise<GeneratedFormRow[]> {
  const instances = await prisma.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: null, formDefinition: { code: { in: [...GENERATED_FORMS] } } },
    select: { id: true, formDefinition: { select: { code: true, title: true } } },
  });
  return instances
    .map((row) => ({ instanceId: row.id, code: row.formDefinition.code, title: row.formDefinition.title }))
    .sort((x, y) => GENERATED_FORMS.indexOf(x.code as never) - GENERATED_FORMS.indexOf(y.code as never));
}

/**
 * One generated form for the read-only preview: the stored copy with the bound values laid over
 * it, and the viewer's roles (which hide the reviewer columns from proponents, as on the form page).
 */
export async function generatedFormPreview(userId: string, protocolId: string, instanceId: string): Promise<GeneratedForm> {
  const form = await formForEdit(userId, protocolId, instanceId);
  if (!(GENERATED_FORMS as readonly string[]).includes(form.instance.formDefinition.code)) {
    throw new AppError("NOT_FOUND", "That form has no preview here.", 404);
  }
  const bound = await versionBoundValues(prisma, form.version.id);
  return {
    instanceId,
    code: form.instance.formDefinition.code,
    title: form.instance.formDefinition.title,
    schema: form.schema,
    data: await effectiveFormData(prisma, form.instance, bound),
    roles: form.roles.filter(isRoleKey) as RoleKey[],
    boundValues: { ...bound, "system.protocolId": protocolId },
  };
}

/** F-27 and F-28 of the working version with their researcher signature slots, for "Agree and sign". */
async function signingForms(user: { id: string; passwordHash: string | null }, protocolId: string, versionId: string): Promise<SigningForm[]> {
  const instances = await prisma.formInstance.findMany({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: null, formDefinition: { code: { in: ["F-27", "F-28"] } } },
    select: { id: true, formDefinition: { select: { code: true } } },
    orderBy: { formDefinition: { code: "asc" } },
  });
  return Promise.all(
    instances.map(async (row) => {
      const form = await formForEdit(user.id, protocolId, row.id);
      const panel = await loadSignaturePanel({
        userId: user.id,
        hasPassword: Boolean(user.passwordHash),
        protocolId,
        instanceId: row.id,
        schema: form.schema,
        roles: form.roles,
      });
      return {
        instanceId: row.id,
        code: form.instance.formDefinition.code,
        title: form.instance.formDefinition.title,
        fields: form.schema.sections.flatMap((section) => section.fields).filter((field) => field.type === "signature"),
        slots: panel.byField,
        signing: { instanceId: row.id, hasPassword: panel.hasPassword, fresh: panel.fresh, email: panel.email },
      };
    }),
  );
}

export type IntakePageExtras = {
  rail: RailSection[];
  missing: ChecklistItem[];
  accountApproved: boolean;
  /** Null when no proponent step is open (submitted, or waiting on someone else). */
  submit: { taskId: string; to: "ADVISER" | "REC"; ready: boolean; summary: string } | null;
  leader: boolean;
  members: Awaited<ReturnType<typeof roster>>["members"];
  details: {
    title: string;
    institution: string;
    institutionAddress: string;
    researchTypeCodes: string[];
    researchTypeOther: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    funding: { code: string; detail: string }[];
  };
  canEditStudy: boolean;
  documents: {
    required: { kind: string; label: string }[];
    files: { id: string; kind: string; originalName: string; scanStatus: string; size: number }[];
    maxBytes: number;
    canUpload: boolean;
  };
  forms: GeneratedFormRow[];
  signing: SigningForm[];
};

export async function intakePageExtras(
  user: { id: string; passwordHash: string | null },
  protocolId: string,
  versionNumber: number,
): Promise<IntakePageExtras> {
  const header = await protocolHeader(user.id, protocolId);
  const version = header.working ?? header.shown;
  const [checklist, target, people, uploads] = await Promise.all([
    getSubmissionChecklist(user.id, protocolId),
    proponentSubmitTarget(protocolId),
    roster(user.id, protocolId),
    listUploads(user.id, protocolId),
  ]);
  const forms = version ? await generatedFormList(version.id) : [];
  const signing = header.working ? await signingForms(user, protocolId, header.working.id) : [];
  const missing = missingOnPage(checklist);
  const leader = Boolean(header.mine?.isLeader && header.mine.role === "PROPONENT" && header.mine.status === "ACTIVE");
  const ready = Boolean(checklist && missing.length === 0 && checklist.accountApproved);
  const uploadGroup = checklist?.groups.find((group) => group.tab === "uploads");
  const stored = Array.isArray(header.protocol.fundingSources) ? header.protocol.fundingSources : [];
  return {
    rail: railSections(checklist, { revision: versionNumber > 1 }),
    missing,
    accountApproved: checklist?.accountApproved ?? true,
    submit:
      checklist && target
        ? {
            taskId: target.taskId,
            to: target.to,
            ready,
            summary: missing.length === 0 ? (checklist.accountApproved ? "Ready to submit" : "Your account needs approval") : `${missing.length === 1 ? "1 item" : `${missing.length} items`} left`,
          }
        : null,
    leader,
    members: people.members,
    details: {
      title: header.protocol.title,
      institution: header.protocol.institution,
      institutionAddress: header.protocol.institutionAddress,
      researchTypeCodes: header.protocol.researchTypeCodes,
      researchTypeOther: header.protocol.researchTypeOther,
      durationMonths: header.protocol.durationMonths,
      expectedParticipants: header.protocol.expectedParticipants,
      studySite: header.protocol.studySite,
      funding: stored.flatMap((item) => {
        if (!item || typeof item !== "object" || !("code" in item) || typeof item.code !== "string") return [];
        return [{ code: item.code, detail: "detail" in item && typeof item.detail === "string" ? item.detail : "" }];
      }),
    },
    canEditStudy: Boolean(header.working && header.mine?.status === "ACTIVE" && (header.mine.role === "PROPONENT" || header.mine.role === "ADVISER")),
    documents: {
      required: (uploadGroup?.items ?? []).map((item) => ({ kind: item.key.replace(/^uploads\./, ""), label: item.label })),
      files: uploads.files.map((file) => ({ id: file.id, kind: file.kind, originalName: file.originalName, scanStatus: file.scanStatus, size: file.size })),
      maxBytes: uploads.maxBytes,
      canUpload: Boolean(header.working && header.mine?.status === "ACTIVE" && header.mine.role === "PROPONENT"),
    },
    forms,
    signing,
  };
}
