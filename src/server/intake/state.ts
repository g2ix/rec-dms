import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { asCellRecord } from "@/lib/forms/cells";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { intakeGaps, type ReferencePoint, type ResearcherSignatures } from "@/lib/intake/gaps";
import { readIntake, type IntakeGap, type IntakeValues } from "@/lib/intake/model";
import { notApplicablePoints } from "@/lib/intake/scoping";
import { prisma } from "@/server/db";
import { formDefinitionForVersion } from "@/server/effective";
import { scopingRules } from "@/server/intake/bound";
import { formsRequiredInOpenStep, formsToSignNow, INTAKE_SIGNED_FORMS, intakeSigningForms, researcherSigning } from "@/server/intake/signing";
import { toRoster } from "@/server/signatures/sign";

type Db = Prisma.TransactionClient | typeof prisma;

export type PointGroup = {
  form: string;
  title: string;
  points: { code: string; label: string; heading: string | null; na: string[] }[];
};

export type IntakeState = {
  usesIntake: boolean;
  versionId: string;
  versionNumber: number;
  values: IntakeValues;
  groups: PointGroup[];
  actionPoints: { code: string; label: string; comments: string }[];
  fundingCodes: string[];
  /** Whether page and line references block submission on this version (see referencePoints below). */
  referencesRequired: boolean;
  /** The active researchers in roster order, with their agreements and F-27 / F-28 signatures. */
  researchers: IntakeResearcher[];
  /** The forms each researcher signs with one act on this version (F-27 and F-28, or F-38 on a revision). */
  signingCodes: string[];
  gaps: IntakeGap[];
};

export type IntakeResearcher = {
  memberId: string;
  userId: string | null;
  name: string;
  declarationsAt: string | null;
  consentsAt: string | null;
  /** Only the forms this version has a copy of. Empty on older versions. */
  signatures: ResearcherSignatures;
};

async function intakeSchema(db: Db, code: string, versionId: string): Promise<{ schema: FormSchema; title: string } | null> {
  const definition = await formDefinitionForVersion(db, code, versionId);
  if (!definition) return null;
  const check = validateSchema(definition.schema);
  if (!check.ok || check.schema.source !== "intake") return null;
  return { schema: check.schema, title: definition.title };
}

/** Whether this version's forms are printed from the intake (version 11-01 and later). */
export async function usesIntake(db: Db, versionId: string): Promise<boolean> {
  return Boolean(await intakeSchema(db, "F-27", versionId));
}

function headingOf(help: string | undefined): string | null {
  const first = help?.split("\n")[0]?.trim() ?? "";
  return first && first === first.toUpperCase() && /[A-Z]/.test(first) ? first : null;
}

/** The intake of a version with the points to reference, the open F-38 points and what still blocks submission. */
export async function intakeState(db: Db, versionId: string): Promise<IntakeState | null> {
  const version = await db.protocolVersion.findUnique({
    where: { id: versionId },
    include: { protocol: { include: { members: { include: { user: true } } } }, intake: { include: { agreements: true } } },
  });
  if (!version) return null;
  const values = readIntake(version.intake);
  const uses = await usesIntake(db, versionId);
  const rules = await scopingRules(db);

  const groups: PointGroup[] = [];
  for (const code of ["F-35", "F-36"]) {
    const found = await intakeSchema(db, code, versionId);
    if (!found) continue;
    const rows = found.schema.sections.flatMap((section) =>
      section.fields.flatMap((field) =>
        field.type === "assessmentTable" && field.columns?.some((column) => column.bind === "intake.references") ? (field.rows ?? []) : [],
      ),
    );
    const na = notApplicablePoints(rules, values.scoping, code, rows.map((row) => row.code));
    groups.push({
      form: code,
      title: found.title,
      points: rows
        .filter((row) => row.reference !== false)
        .map((row) => ({ code: row.code, label: row.label, heading: headingOf(row.help), na: na[row.code] ?? [] })),
    });
  }

  const actionPoints: IntakeState["actionPoints"] = [];
  const f38 = await intakeSchema(db, "F-38", versionId);
  if (f38) {
    const instance = await db.formInstance.findFirst({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: null, formDefinition: { code: "F-38" } },
      select: { data: true },
    });
    const data = instance?.data && typeof instance.data === "object" && !Array.isArray(instance.data) ? (instance.data as Record<string, unknown>) : {};
    for (const field of f38.schema.sections.flatMap((section) => section.fields)) {
      if (field.type !== "assessmentTable" || !field.columns?.some((column) => column.bind === "intake.actions")) continue;
      const table = asCellRecord(data[field.id]);
      for (const row of field.rows ?? []) {
        const cells = asCellRecord(table[row.id]);
        if (cells.needs_action !== true) continue;
        actionPoints.push({ code: row.code, label: row.label, comments: typeof cells.panel_comments === "string" ? cells.panel_comments : "" });
      }
    }
  }

  const fundingCodes = Array.isArray(version.protocol.fundingSources)
    ? version.protocol.fundingSources.flatMap((item) =>
        item && typeof item === "object" && !Array.isArray(item) && typeof (item as { code?: unknown }).code === "string" ? [(item as { code: string }).code] : [],
      )
    : [];
  // Each researcher's agreements and their signature on F-27 and F-28: one checklist item each.
  // Signatures count only on forms the open proponent step requires (the first submission, not a
  // revision that fills F-38 only), as the step's own form check does.
  const signingForms = uses ? await intakeSigningForms(db, versionId) : [];
  const requiredHere = uses ? await formsRequiredInOpenStep(db, versionId) : new Set<string>();
  const signing = await researcherSigning(db, signingForms, toRoster(version.protocol.members.filter((member) => member.status === "ACTIVE" || member.status === "INVITED")));
  const researchers: IntakeResearcher[] = version.protocol.members
    .filter((member) => member.role === "PROPONENT" && member.status === "ACTIVE" && member.user)
    .sort((a, b) => a.rosterOrder - b.rosterOrder)
    .map((member) => {
      const agreed = (kind: string) => version.intake?.agreements.find((item) => item.memberId === member.id && item.kind === kind)?.agreedAt.toISOString() ?? null;
      const forms = (member.userId ? signing.get(member.userId)?.forms : undefined) ?? {};
      const signatures: ResearcherSignatures = {};
      for (const code of INTAKE_SIGNED_FORMS) {
        const entry = forms[code];
        if (entry) signatures[code] = entry.status;
      }
      return {
        memberId: member.id,
        userId: member.userId,
        name: member.user?.displayName ?? "",
        declarationsAt: agreed("DECLARATIONS"),
        consentsAt: agreed("F28_CONSENT"),
        signatures,
      };
    });
  // References are required on a version that carries F-35 and F-36: the first submission, or a
  // resubmission whose workflow asks for them again. A resubmission answers F-38 instead.
  const carried = new Set(
    (
      await db.formInstance.findMany({
        where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, filledByMemberId: null, formDefinition: { code: { in: ["F-35", "F-36"] } } },
        select: { formDefinition: { select: { code: true } } },
      })
    ).map((row) => row.formDefinition.code),
  );
  const referencePoints: ReferencePoint[] = groups
    .filter((group) => version.number === 1 || carried.has(group.form))
    .flatMap((group) => group.points.filter((point) => point.na.length === 0).map((point) => ({ form: group.form, code: point.code, label: point.label })));
  const gaps = uses
    ? intakeGaps({
        intake: values,
        study: {
          researchTypeCodes: version.protocol.researchTypeCodes,
          durationMonths: version.protocol.durationMonths,
          expectedParticipants: version.protocol.expectedParticipants,
          studySite: version.protocol.studySite,
          fundingCodes,
        },
        researchers: researchers.map((researcher) => ({
          ...researcher,
          signatures: Object.fromEntries(Object.entries(researcher.signatures).filter(([code]) => requiredHere.has(code))),
        })),
        referencePoints,
        actionPoints,
      })
    : [];
  const signingCodes = uses ? (await formsToSignNow(db, versionId)).map((form) => form.code as string) : [];
  // INTAKE-04: each comment of the latest return on this version must be ticked Done before resubmitting.
  if (uses && version.state === "WORKING") gaps.push(...(await openReturnNotes(db, versionId)));
  return { usesIntake: uses, versionId, versionNumber: version.number, values, groups, actionPoints, fundingCodes, referencesRequired: referencePoints.length > 0, researchers, signingCodes, gaps };
}

const NOTE_ROLE: Record<string, string> = { ADVISER: "Adviser", REC_STAFF: "REC Staff", PANEL: "Panel" };
const NOTE_PLACE: Record<string, string> = {
  general: "the protocol",
  study: "Study",
  team: "Team",
  funding: "Funding and budget",
  participants: "Participants & consent",
  coi: "Conflict of interest",
  references: "Where to find it",
  documents: "Documents",
  "upload:MANUSCRIPT": "the manuscript",
  "upload:COVER_LETTER": "the cover letter",
  "upload:SUPPORTING": "a supporting file",
};

async function openReturnNotes(db: Db, versionId: string): Promise<IntakeGap[]> {
  const latest = await db.revisionNote.findFirst({ where: { protocolVersionId: versionId, taskId: { not: null } }, orderBy: { sentAt: "desc" }, select: { taskId: true } });
  if (!latest?.taskId) return [];
  const open = await db.revisionNote.findMany({ where: { protocolVersionId: versionId, taskId: latest.taskId, doneAt: null }, orderBy: { createdAt: "asc" } });
  return open.map((note) => ({
    section: "returnNotes" as const,
    message: `Tick Done on the ${NOTE_ROLE[note.authorRole] ?? "REC"} comment about ${NOTE_PLACE[note.anchor] ?? note.anchor}.`,
    detail: { codes: [note.id] },
  }));
}

/** intakeState of one version, once per request: the page, the checklist and the layout share it. */
export const intakeStateOf = cache((versionId: string) => intakeState(prisma, versionId));
