import "server-only";
import type { Prisma } from "@prisma/client";
import { AuditAction } from "@/lib/audit-log";
import { RAIL_LABELS, type RailKey } from "@/lib/intake/rail";
import { parseGraph, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { returnOutcomes, returnsToProponent } from "@/lib/workflow/review-stage";
import { audit, auditRequestMeta, diffOf } from "@/server/audit";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { usesIntake } from "@/server/intake/state";

type Tx = Prisma.TransactionClient;

/** Who returned it, as the proponents see it. Never a person's name. */
export type NoteRole = "ADVISER" | "REC_STAFF" | "PANEL";
export const NOTE_ROLE_LABEL: Record<NoteRole, string> = { ADVISER: "Adviser", REC_STAFF: "REC Staff", PANEL: "Panel" };

/** Intake sections a note can be pinned to (Agree and sign and Actions taken are not). */
export const NOTE_SECTIONS: readonly RailKey[] = ["study", "team", "funding", "participants", "coi", "references", "documents"];
const UPLOAD_LABEL: Record<string, string> = {
  MANUSCRIPT: "Manuscript",
  COVER_LETTER: "Cover letter",
  SUPPORTING: "Supporting file",
};

export type NoteAnchor = { key: string; label: string };

export function anchorLabel(anchor: string): string {
  if (anchor === "general") return "General";
  if (anchor.startsWith("upload:")) {
    const kind = anchor.slice("upload:".length);
    return UPLOAD_LABEL[kind] ?? kind.toLowerCase().replaceAll("_", " ");
  }
  return RAIL_LABELS[anchor as RailKey] ?? anchor;
}

/** Where a note points on the Intake page: a section, or the Documents section for an upload. */
export function anchorSection(anchor: string): RailKey | null {
  if (anchor.startsWith("upload:")) return "documents";
  return (NOTE_SECTIONS as readonly string[]).includes(anchor) ? (anchor as RailKey) : null;
}

export function noteRoleOf(step: Step): NoteRole {
  const rule = step.assignee;
  if (rule?.kind === "PROTOCOL_ADVISER") return "ADVISER";
  if (rule?.kind === "ROLE" && rule.role === "REC_STAFF") return "REC_STAFF";
  return "PANEL";
}

function anchorsFor(graph: WorkflowGraph): NoteAnchor[] {
  const start = graph.steps.find((step) => step.key === graph.startStep);
  const uploads = [...new Set((start?.uploads ?? []).map((upload) => upload.kind)), "SUPPORTING"];
  return [
    { key: "general", label: "General" },
    ...NOTE_SECTIONS.map((key) => ({ key, label: RAIL_LABELS[key] })),
    ...uploads.map((kind) => ({ key: `upload:${kind}`, label: anchorLabel(`upload:${kind}`) })),
  ];
}

/**
 * The open task this person may return with, on a protocol: a main task assigned to them (or
 * claimable by them) whose step has an outcome leading back to the proponents. Null when none.
 */
export async function returnableTask(db: Tx | typeof prisma, userId: string, protocolId: string) {
  const tasks = await db.task.findMany({
    where: {
      kind: "MAIN",
      status: { in: ["OPEN", "CLAIMED"] },
      instance: { protocolId, status: "RUNNING" },
      OR: [{ assigneeUserId: userId }, { assigneeUserId: null }],
    },
    include: { instance: { include: { version: { select: { graph: true } } } } },
  });
  for (const task of tasks) {
    if (!task.instance) continue;
    const parsed = parseGraph(task.instance.version.graph);
    if (!parsed.ok) continue;
    const step = parsed.graph.steps.find((item) => item.key === task.stepKey);
    if (!step || returnOutcomes(parsed.graph, step).length === 0) continue;
    // Protocols on the 2025 forms keep their return flow: a single comment, no pinned notes.
    if (!(await usesIntake(db, task.instance.protocolVersionId))) continue;
    if (task.assigneeUserId !== userId && !(await mayClaim(db, userId, protocolId, step))) continue;
    return { task, step, graph: parsed.graph, versionId: task.instance.protocolVersionId, role: noteRoleOf(step) };
  }
  return null;
}

async function mayClaim(db: Tx | typeof prisma, userId: string, protocolId: string, step: Step): Promise<boolean> {
  const rule = step.assignee;
  if (rule?.kind === "PROTOCOL_ADVISER") {
    return (await db.protocolMember.count({ where: { protocolId, userId, role: "ADVISER", status: "ACTIVE" } })) > 0;
  }
  if (rule?.kind === "ROLE") {
    return (await db.userRole.count({ where: { userId, revokedAt: null, role: { key: rule.role } } })) > 0;
  }
  return false;
}

export type DraftNote = { id: string; anchor: string; anchorLabel: string; body: string };

/** The returner's panel: where they can pin a comment, and their drafts not sent yet. */
export async function returnNotesPanel(userId: string, protocolId: string): Promise<{ taskId: string; anchors: NoteAnchor[]; drafts: DraftNote[] } | null> {
  const found = await returnableTask(prisma, userId, protocolId);
  if (!found) return null;
  const drafts = await prisma.revisionNote.findMany({
    where: { protocolVersionId: found.versionId, authorId: userId, taskId: null },
    orderBy: { createdAt: "asc" },
  });
  return {
    taskId: found.task.id,
    anchors: anchorsFor(found.graph),
    drafts: drafts.map((note) => ({ id: note.id, anchor: note.anchor, anchorLabel: anchorLabel(note.anchor), body: note.body })),
  };
}

export async function addDraftNote(input: { userId: string; protocolId: string; anchor: string; body: string }) {
  const body = input.body.trim();
  if (!body) throw new AppError("INVALID", "Type the comment first.", 400);
  if (body.length > 4000) throw new AppError("INVALID", "Keep a comment under 4,000 characters.", 400);
  const found = await returnableTask(prisma, input.userId, input.protocolId);
  if (!found) throw new AppError("FORBIDDEN", "You have no step on this protocol that can return it.", 403);
  if (!anchorsFor(found.graph).some((anchor) => anchor.key === input.anchor)) throw new AppError("INVALID", "Choose where the comment belongs.", 400);
  return prisma.revisionNote.create({
    data: { protocolVersionId: found.versionId, authorId: input.userId, authorRole: found.role, anchor: input.anchor, body },
  });
}

export async function removeDraftNote(input: { userId: string; noteId: string }) {
  const note = await prisma.revisionNote.findUnique({ where: { id: input.noteId } });
  if (!note || note.authorId !== input.userId || note.taskId) throw new AppError("NOT_FOUND", "That draft comment was not found.", 404);
  await prisma.revisionNote.delete({ where: { id: note.id } });
}

/**
 * Called by the engine when a task completes. On a return, the actor's drafts on that version go
 * out with it; on any other outcome they are discarded, so nothing reaches the proponents unless
 * the protocol is actually returned.
 */
export async function settleRevisionNotes(
  tx: Tx,
  input: { graph: WorkflowGraph; stepKey: string; outcome: string | null; taskId: string; versionId: string; userId: string; at?: Date },
): Promise<number> {
  const where = { protocolVersionId: input.versionId, authorId: input.userId, taskId: null };
  if (!returnsToProponent(input.graph, input.stepKey, input.outcome)) {
    await tx.revisionNote.deleteMany({ where });
    return 0;
  }
  const sent = await tx.revisionNote.updateMany({ where, data: { taskId: input.taskId, sentAt: input.at ?? new Date() } });
  return sent.count;
}

export type SentNote = {
  id: string;
  anchor: string;
  anchorLabel: string;
  section: RailKey | null;
  role: NoteRole;
  roleLabel: string;
  body: string;
  done: boolean;
  reply: string;
  sentAt: Date;
};

/** The comments of the latest return on this version (the rows to fix). */
export async function latestReturnNotes(db: Tx | typeof prisma, versionId: string): Promise<SentNote[]> {
  const latest = await db.revisionNote.findFirst({
    where: { protocolVersionId: versionId, taskId: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { taskId: true },
  });
  if (!latest?.taskId) return [];
  const notes = await db.revisionNote.findMany({ where: { protocolVersionId: versionId, taskId: latest.taskId }, orderBy: { createdAt: "asc" } });
  return notes.map((note) => ({
    id: note.id,
    anchor: note.anchor,
    anchorLabel: anchorLabel(note.anchor),
    section: anchorSection(note.anchor),
    role: note.authorRole as NoteRole,
    roleLabel: NOTE_ROLE_LABEL[note.authorRole as NoteRole] ?? "REC",
    body: note.body,
    done: Boolean(note.doneAt),
    reply: note.reply ?? "",
    sentAt: note.sentAt ?? note.createdAt,
  }));
}

/** A proponent ticks a comment Done (or not) and may reply. Only while the version is being prepared. */
export async function answerNote(input: { userId: string; noteId: string; done: boolean; reply: string }) {
  const reply = input.reply.trim();
  if (reply.length > 4000) throw new AppError("INVALID", "Keep a reply under 4,000 characters.", 400);
  const meta = await auditRequestMeta({});
  return prisma.$transaction(async (tx) => {
    const note = await tx.revisionNote.findUnique({ where: { id: input.noteId }, include: { protocolVersion: true } });
    if (!note?.taskId) throw new AppError("NOT_FOUND", "That comment was not found.", 404);
    const member = await tx.protocolMember.findFirst({
      where: { protocolId: note.protocolVersion.protocolId, userId: input.userId, status: "ACTIVE", role: "PROPONENT" },
    });
    if (!member) throw new AppError("FORBIDDEN", "Only the proponents answer these comments.", 403);
    if (note.protocolVersion.state !== "WORKING") throw new AppError("INVALID", "This version was submitted and can no longer change.", 409);
    const updated = await tx.revisionNote.update({
      where: { id: note.id },
      data: { doneAt: input.done ? note.doneAt ?? new Date() : null, doneById: input.done ? input.userId : null, reply: reply || null },
    });
    await audit.record(tx, {
      actorUserId: input.userId,
      action: AuditAction.revisionNoteAnswered,
      entityType: "revision_note",
      entityId: note.id,
      protocolId: note.protocolVersion.protocolId,
      diff: diffOf({ done: Boolean(note.doneAt), reply: note.reply ?? "" }, { done: input.done, reply }),
      meta,
    });
    return updated;
  });
}
