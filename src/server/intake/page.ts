import "server-only";
import type { FormSchema } from "@/lib/forms/schema";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { railSections, missingOnPage, type RailSection } from "@/lib/intake/rail";
import type { ChecklistItem } from "@/lib/protocols/checklist";
import type { IntakeSigningView, SigningRow } from "@/lib/intake/signing-view";
import { formatManila } from "@/lib/time";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { getSubmissionChecklist, proponentSubmitTarget } from "@/server/protocols/checklist";
import { formForEdit, listUploads, protocolHeader, roster } from "@/server/protocols/read";
import { formsToSignNow, intakeRoster, researcherSigning } from "@/server/intake/signing";
import { intakeStateOf } from "@/server/intake/state";
import { imageDataUrl } from "@/server/signatures/views";
import { contactEmail, signingStepUpFresh } from "@/server/stepup";
import { proponentsHoldVersion } from "@/server/revision/hold";

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

/**
 * "Agree and sign": one row per researcher. Every row shows its status; only the viewer's own row
 * carries the date, the image and the button, so nobody signs for someone else.
 */
async function intakeSigning(
  user: { id: string; passwordHash: string | null },
  protocolId: string,
  versionId: string,
  editable: boolean,
): Promise<IntakeSigningView | null> {
  const forms = await formsToSignNow(prisma, versionId);
  if (forms.length === 0) return null;
  const [state, roster, fresh, email, saved] = await Promise.all([
    intakeStateOf(versionId),
    intakeRoster(prisma, protocolId),
    signingStepUpFresh(user.id),
    contactEmail(user.id),
    prisma.signature.findFirst({ where: { userId: user.id, active: true }, orderBy: { version: "desc" }, select: { imageKey: true } }),
  ]);
  const mine = (await researcherSigning(prisma, forms, roster)).get(user.id);
  const images = new Map<string, string | null>();
  const rows: SigningRow[] = [];
  for (const researcher of state?.researchers ?? []) {
    const statuses = forms.map((form) => ({ code: form.code, status: researcher.signatures[form.code] ?? "unsigned" }));
    const allSigned = statuses.every((item) => item.status === "signed");
    const anyMark = statuses.some((item) => item.status !== "unsigned");
    const isMine = researcher.userId === user.id;
    let signedOnLabel: string | null = null;
    let image: string | null = null;
    if (isMine && mine && allSigned) {
      const live = Object.values(mine.forms).filter((entry) => entry?.status === "signed");
      const latest = live.reduce<Date | null>((at, entry) => (entry?.signedAt && (!at || entry.signedAt > at) ? entry.signedAt : at), null);
      signedOnLabel = latest ? formatManila(latest, "d MMM yyyy") : null;
      const signatureId = live.find((entry) => entry?.signatureId)?.signatureId ?? null;
      const signature = signatureId ? await prisma.signature.findUnique({ where: { id: signatureId }, select: { imageKey: true } }) : null;
      image = signature ? await imageDataUrl(signature.imageKey, images) : null;
    }
    rows.push({
      memberId: researcher.memberId,
      name: researcher.name,
      mine: isMine,
      agreed: Boolean(researcher.declarationsAt && researcher.consentsAt),
      state: allSigned ? "signed" : anyMark ? "again" : "unsigned",
      toSign: statuses.filter((item) => item.status !== "signed").map((item) => item.code),
      signedOnLabel,
      imageDataUrl: image,
    });
  }
  return {
    forms: forms.map((form) => ({ code: form.code, title: form.instance.formDefinition.title })),
    rows,
    editable,
    prompt: { hasPassword: Boolean(user.passwordHash), fresh, email },
    savedImageDataUrl: saved ? await imageDataUrl(saved.imageKey, images) : null,
  };
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
  /** Null on versions whose F-27 and F-28 are not printed from the intake. */
  signing: IntakeSigningView | null;
};

export async function intakePageExtras(
  user: { id: string; passwordHash: string | null },
  protocolId: string,
  versionNumber: number,
  /** INTAKE-04: the protocol was returned, so the rail opens on "Returned for revision". */
  returned = false,
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
  const proponent = Boolean(header.mine?.status === "ACTIVE" && header.mine.role === "PROPONENT");
  const holds = await proponentsHoldVersion(prisma, protocolId);
  const signing = header.working ? await intakeSigning(user, protocolId, header.working.id, proponent && holds) : null;
  const missing = missingOnPage(checklist);
  const leader = Boolean(header.mine?.isLeader && header.mine.role === "PROPONENT" && header.mine.status === "ACTIVE");
  const ready = Boolean(checklist && missing.length === 0 && checklist.accountApproved);
  const uploadGroup = checklist?.groups.find((group) => group.tab === "uploads");
  const stored = Array.isArray(header.protocol.fundingSources) ? header.protocol.fundingSources : [];
  return {
    rail: railSections(checklist, { revision: versionNumber > 1 || returned }).map((section) =>
      section.key === "actions" && returned ? { ...section, label: "Returned for revision" } : section,
    ),
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
    canEditStudy: Boolean(holds && header.working && header.mine?.status === "ACTIVE" && (header.mine.role === "PROPONENT" || header.mine.role === "ADVISER")),
    documents: {
      required: (uploadGroup?.items ?? []).map((item) => ({ kind: item.key.replace(/^uploads\./, ""), label: item.label })),
      files: uploads.files.map((file) => ({ id: file.id, kind: file.kind, originalName: file.originalName, scanStatus: file.scanStatus, size: file.size })),
      maxBytes: uploads.maxBytes,
      canUpload: Boolean(header.working && header.mine?.status === "ACTIVE" && header.mine.role === "PROPONENT" && (await proponentsHoldVersion(prisma, protocolId))),
    },
    forms,
    signing,
  };
}
