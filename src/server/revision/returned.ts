import "server-only";
import { asCellRecord } from "@/lib/forms/cells";
import { effectiveCell, validateSchema, type FormSchema } from "@/lib/forms/schema";
import { suggestedManuscriptName } from "@/lib/protocols/format";
import { onProponentSide } from "@/lib/workflow/blinding";
import { parseGraph, type WorkflowGraph } from "@/lib/workflow/graph";
import { isReleaseStep, returnsToProponent } from "@/lib/workflow/review-stage";
import { prisma } from "@/server/db";
import { formDefinitionForVersion, workflowVersionFor } from "@/server/effective";
import { intakeStateOf, usesIntake } from "@/server/intake/state";
import { proponentSubmitTarget } from "@/server/protocols/checklist";
import { protocolHeader } from "@/server/protocols/read";
import { proponentsHoldVersion } from "@/server/revision/hold";
import { latestReturnNotes, NOTE_ROLE_LABEL, noteRoleOf, type NoteRole, type SentNote } from "@/server/revision/notes";
import { releasedFormCodes } from "@/server/revision/visibility";
import { overridesOf } from "@/server/workflow/prefill";

/** One flagged point to fix after a panel return. Labels say "Panel", never a person. */
export type PanelRow = {
  code: string;
  label: string;
  /** The panel's comments and recommendations (from F-37, with the chair's wording where it overrides). */
  comments: string;
  /** Version 3 and later: the panel's remarks on the last F-38, and the action given then (read-only). */
  remarks: string;
  earlierAction: string;
};

export type ReleasedDocument = { instanceId: string; code: string; title: string };

export type UploadRow = { id: string; kind: string; label: string; name: string; scanStatus: string; tag: string | null };

export type ReturnedView = {
  role: NoteRole;
  roleLabel: string;
  /** The version the proponents prepare: the reopened one, or the next number before "Start version N". */
  versionNumber: number;
  returnedAt: Date | null;
  dueAt: Date | null;
  /** Where the resubmission goes, from the workflow's next step. */
  next: "ADVISER" | "REC" | null;
  /** False until the leader starts the new version: the rows are then read-only. */
  started: boolean;
  canStart: boolean;
  editable: boolean;
  released: ReleasedDocument[];
  panelRows: PanelRow[];
  notes: SentNote[];
  /** The general comment typed when returning (shown as one row; the chair's comment on an exemption). */
  comment: string | null;
  manuscript: { required: boolean; file: UploadRow | null; suggestedName: string | null };
  uploads: UploadRow[];
};

const UPLOAD_LABEL: Record<string, string> = { MANUSCRIPT: "Manuscript", COVER_LETTER: "Cover letter", SUPPORTING: "Supporting file" };

/**
 * The "Returned for revision" view of the Intake tab, for the proponents and the adviser of a
 * protocol on the November forms. Null when the protocol is not returned to them.
 */
export async function returnedView(userId: string, protocolId: string): Promise<ReturnedView | null> {
  const header = await protocolHeader(userId, protocolId);
  const members = await prisma.protocolMember.findMany({ where: { protocolId }, select: { userId: true, role: true, status: true } });
  if (!onProponentSide(members, userId)) return null;
  const shown = header.shown;
  if (!shown || !(await usesIntake(prisma, shown.id))) return null;
  const leader = Boolean(header.mine?.isLeader && header.mine.role === "PROPONENT" && header.mine.status === "ACTIVE");
  const proponent = header.mine?.role === "PROPONENT" && header.mine.status === "ACTIVE";

  // A decision that asks for changes, released: waiting for the leader to start the next version.
  if (!header.working && header.protocol.status === "Awaiting Revision") {
    const last = header.protocol.versions.find((version) => version.state === "SUBMITTED");
    if (!last) return null;
    const release = await latestRelease(last.id);
    const resubmission = await workflowVersionFor(prisma, "RESUBMISSION", header.protocol.createdAt);
    const graph = resubmission ? parseGraph(resubmission.graph) : null;
    return {
      role: "PANEL",
      roleLabel: NOTE_ROLE_LABEL.PANEL,
      versionNumber: last.number + 1,
      returnedAt: release?.completedAt ?? null,
      dueAt: await revisionDue(protocolId),
      next: graph?.ok ? await nextFromStart(graph.graph, protocolId) : null,
      started: false,
      canStart: leader,
      editable: false,
      released: await releasedDocuments(last.id),
      panelRows: await flaggedRows(last.id),
      notes: [],
      comment: null,
      manuscript: { required: true, file: null, suggestedName: null },
      uploads: [],
    };
  }

  const working = header.working;
  if (!working || !(await proponentsHoldVersion(prisma, protocolId))) return null;
  const back = await latestReturnTask(working.id);
  if (!back && working.number === 1) return null;

  const state = await intakeStateOf(working.id);
  const previous = header.protocol.versions.find((version) => version.number === working.number - 1) ?? null;
  const target = await proponentSubmitTarget(protocolId);
  const open = await openProponentStep(protocolId);
  const files = await prisma.storedFile.findMany({
    where: { protocolVersionId: working.id, kind: { in: ["MANUSCRIPT", "COVER_LETTER", "SUPPORTING"] } },
    orderBy: { createdAt: "desc" },
  });
  const earlierKinds = new Set(
    previous ? (await prisma.storedFile.findMany({ where: { protocolVersionId: previous.id }, select: { kind: true } })).map((file) => file.kind as string) : [],
  );
  const uploadRow = (file: (typeof files)[number]): UploadRow => ({
    id: file.id,
    kind: file.kind,
    label: UPLOAD_LABEL[file.kind] ?? file.kind,
    name: file.suggestedName || file.originalName,
    scanStatus: file.scanStatus,
    tag:
      working.number > 1
        ? file.carriedFromId
          ? `Carried over from version ${working.number - 1}`
          : earlierKinds.has(file.kind)
            ? `Replaced in version ${working.number}`
            : `New in version ${working.number}`
        : null,
  });
  const manuscript = files.find((file) => file.kind === "MANUSCRIPT") ?? null;
  const panelRows = working.number > 1 ? await panelRowsOf(working.id, previous?.id ?? null, state?.actionPoints ?? []) : [];
  const release = previous ? await latestRelease(previous.id) : null;
  return {
    role: back ? back.role : "PANEL",
    roleLabel: NOTE_ROLE_LABEL[back ? back.role : "PANEL"],
    versionNumber: working.number,
    returnedAt: back?.at ?? release?.completedAt ?? null,
    dueAt: open?.dueAt ?? (await revisionDue(protocolId)),
    next: target?.to ?? null,
    started: true,
    canStart: false,
    editable: Boolean(proponent),
    released: previous ? await releasedDocuments(previous.id) : [],
    panelRows,
    notes: back ? await latestReturnNotes(prisma, working.id) : [],
    comment: back?.comment?.trim() || null,
    manuscript: {
      required: Boolean(open?.uploads.includes("MANUSCRIPT")) && working.number > 1,
      file: manuscript ? uploadRow(manuscript) : null,
      suggestedName: suggestedManuscriptName(working.label),
    },
    uploads: files.filter((file) => file.kind !== "MANUSCRIPT").map(uploadRow),
  };
}

/** The latest completed task on this version's workflow passes that returned it to the proponents. */
async function latestReturnTask(versionId: string): Promise<{ role: NoteRole; at: Date | null; comment: string | null } | null> {
  const tasks = await prisma.task.findMany({
    where: { kind: "MAIN", status: "COMPLETED", instance: { protocolVersionId: versionId } },
    orderBy: { completedAt: "desc" },
    take: 30,
    include: { instance: { include: { version: { select: { graph: true } } } } },
  });
  for (const task of tasks) {
    const parsed = task.instance ? parseGraph(task.instance.version.graph) : null;
    if (!parsed?.ok || !task.stepKey) continue;
    if (!returnsToProponent(parsed.graph, task.stepKey, task.outcome)) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (!step) continue;
    return { role: noteRoleOf(step), at: task.completedAt, comment: task.comment };
  }
  return null;
}

/** The release of a version's decision: the completed task on a step that generated documents. */
async function latestRelease(versionId: string) {
  const tasks = await prisma.task.findMany({
    where: { kind: "MAIN", status: "COMPLETED", instance: { protocolVersionId: versionId } },
    orderBy: { completedAt: "desc" },
    include: { instance: { include: { version: { select: { graph: true } } } } },
  });
  for (const task of tasks) {
    const parsed = task.instance ? parseGraph(task.instance.version.graph) : null;
    if (!parsed?.ok) continue;
    if (isReleaseStep(parsed.graph.steps.find((item) => item.key === task.stepKey))) return task;
  }
  return null;
}

/** The revision deadline: the wait for the revised protocol, open or answered. */
async function revisionDue(protocolId: string): Promise<Date | null> {
  const wait = await prisma.task.findFirst({
    where: { instance: { protocolId }, kind: "MAIN", dueAt: { not: null }, status: { in: ["OPEN", "CLAIMED", "COMPLETED"] }, stepKey: { in: await waitStepKeys(protocolId) } },
    orderBy: { createdAt: "desc" },
    select: { dueAt: true },
  });
  return wait?.dueAt ?? null;
}

async function waitStepKeys(protocolId: string): Promise<string[]> {
  const instances = await prisma.workflowInstance.findMany({ where: { protocolId }, select: { version: { select: { graph: true } } } });
  const keys = new Set<string>();
  for (const instance of instances) {
    const parsed = parseGraph(instance.version.graph);
    if (!parsed.ok) continue;
    for (const step of parsed.graph.steps) if (step.type === "WAIT_PROPONENT") keys.add(step.key);
  }
  return [...keys];
}

/** The leader's open step: its due date and required uploads. */
async function openProponentStep(protocolId: string): Promise<{ dueAt: Date | null; uploads: string[] } | null> {
  const instance = await prisma.workflowInstance.findFirst({
    where: { protocolId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { version: true, tasks: { where: { status: { in: ["OPEN", "CLAIMED"] }, kind: "MAIN" } } },
  });
  const parsed = instance ? parseGraph(instance.version.graph) : null;
  if (!instance || !parsed?.ok) return null;
  for (const task of instance.tasks) {
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.assignee?.kind !== "PROTOCOL_LEADER") continue;
    return { dueAt: task.dueAt, uploads: (step.uploads ?? []).filter((upload) => upload.required).map((upload) => upload.kind) };
  }
  return null;
}

/** Before the next version exists: where its start step goes, read from the resubmission graph. */
async function nextFromStart(graph: WorkflowGraph, protocolId: string): Promise<"ADVISER" | "REC"> {
  const hasAdviser = (await prisma.protocolMember.count({ where: { protocolId, role: "ADVISER", status: "ACTIVE" } })) > 0;
  const next = graph.transitions.filter((transition) => transition.from === graph.startStep).map((transition) => graph.steps.find((step) => step.key === transition.to));
  return hasAdviser && next.some((step) => step?.assignee?.kind === "PROTOCOL_ADVISER") ? "ADVISER" : "REC";
}

/** Forms of this version released to the proponents (release copies only, filtered by the setting). */
export async function releasedDocuments(versionId: string): Promise<ReleasedDocument[]> {
  const allowed = await releasedFormCodes(prisma);
  const files = await prisma.storedFile.findMany({
    where: { protocolVersionId: versionId, audience: "PROPONENT", formInstanceId: { not: null } },
    select: { formInstance: { select: { id: true, formDefinition: { select: { code: true, title: true } } } } },
  });
  const seen = new Map<string, ReleasedDocument>();
  for (const file of files) {
    const instance = file.formInstance;
    if (!instance || !allowed.includes(instance.formDefinition.code) || seen.has(instance.id)) continue;
    seen.set(instance.id, { instanceId: instance.id, code: instance.formDefinition.code, title: instance.formDefinition.title });
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function sharedCopy(versionId: string, code: string) {
  const definition = await formDefinitionForVersion(prisma, code, versionId);
  if (!definition) return null;
  const instance = await prisma.formInstance.findFirst({
    where: { ownerType: "PROTOCOL_VERSION", ownerId: versionId, formDefinitionId: definition.id, filledByMemberId: null },
  });
  if (!instance) return null;
  const check = validateSchema(definition.schema);
  return { instance, definitionId: definition.id, schema: check.ok ? check.schema : null };
}

function rowLabels(schema: FormSchema | null): Map<string, { code: string; label: string }> {
  const labels = new Map<string, { code: string; label: string }>();
  for (const field of schema?.sections.flatMap((section) => section.fields) ?? []) {
    if (field.type !== "assessmentTable") continue;
    for (const row of field.rows ?? []) labels.set(`${field.id}.${row.id}`, { code: row.code, label: row.label });
  }
  return labels;
}

/**
 * The points flagged on a decided version, before the next version exists: from the released F-38
 * when that round was a resubmission (rows still needing action), else from F-37 (the chair's
 * wording where it overrides the reviewer's).
 */
async function flaggedRows(versionId: string): Promise<PanelRow[]> {
  // The panel's words show only from a form REC releases to the proponents (revision.releasedForms).
  const allowed = await releasedFormCodes(prisma);
  const f38 = await sharedCopy(versionId, "F-38");
  const f38Labels = rowLabels(f38?.schema ?? null);
  const rows: PanelRow[] = [];
  if (f38 && allowed.includes("F-38")) {
    const data = asCellRecord(f38.instance.data);
    for (const field of ["praf", "icf"]) {
      for (const [rowId, cells] of Object.entries(asCellRecord(data[field]))) {
        const row = asCellRecord(cells) as Row;
        if (row.needs_action !== true) continue;
        const label = f38Labels.get(`${field}.${rowId}`);
        rows.push({ code: label?.code ?? rowId, label: label?.label ?? "", comments: text(row.panel_comments), remarks: text(row.panel_remarks), earlierAction: "" });
      }
    }
    if (rows.length > 0) return rows;
  }
  const f37 = await sharedCopy(versionId, "F-37");
  if (!f37 || !allowed.includes("F-37")) return rows;
  const labels = rowLabels(f37.schema);
  const data = asCellRecord(f37.instance.data);
  for (const field of ["praf", "icf"]) {
    const overrides = await overridesOf(prisma, f37.definitionId, field);
    for (const [rowId, cells] of Object.entries(asCellRecord(data[field]))) {
      const row = asCellRecord(cells) as Row;
      if (row.needs_action !== true) continue;
      const label = f38Labels.get(`${field}.${rowId}`) ?? labels.get(`${field}.${rowId}`);
      const comments = [effectiveCell(row, "comments", overrides), effectiveCell(row, "recommendations", overrides)].map(text).filter(Boolean).join("\n\n");
      rows.push({ code: label?.code ?? rowId, label: label?.label ?? "", comments, remarks: "", earlierAction: "" });
    }
  }
  return rows;
}

/** The working version's rows: the open F-38 points, with the last round's remarks and action on version 3+. */
async function panelRowsOf(versionId: string, previousId: string | null, points: { code: string; label: string; comments: string }[]): Promise<PanelRow[]> {
  const earlier = previousId ? await prisma.protocolIntake.findUnique({ where: { protocolVersionId: previousId }, select: { actions: true } }) : null;
  const earlierActions = asCellRecord(earlier?.actions);
  const remarks = new Map<string, string>();
  if (previousId) {
    const f38 = await sharedCopy(previousId, "F-38");
    if (f38) {
      const labels = rowLabels(f38.schema);
      const data = asCellRecord(f38.instance.data);
      for (const field of ["praf", "icf"]) {
        for (const [rowId, cells] of Object.entries(asCellRecord(data[field]))) {
          const code = labels.get(`${field}.${rowId}`)?.code ?? rowId;
          const value = text((asCellRecord(cells) as Row).panel_remarks);
          if (value) remarks.set(code, value);
        }
      }
    }
  }
  return points.map((point) => ({
    code: point.code,
    label: point.label,
    comments: point.comments,
    remarks: remarks.get(point.code) ?? "",
    earlierAction: text(earlierActions[point.code]),
  }));
}
