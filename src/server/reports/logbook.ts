import "server-only";
import { auditActionLabel } from "@/lib/audit-log";
import { readTransaction, useAppSchema } from "@/server/db";
import { AppError } from "@/server/errors";
import { canViewProtocol } from "@/server/protocols/read";
import { isCommitteeStaff } from "@/server/authz/staff";
import { stepFacts } from "@/server/reports/steps";
import { fileAccessAllowed } from "@/server/revision/visibility";

const LOG_ACTIONS = [
  "workflow.instance_started",
  "workflow.step_entered",
  "workflow.instance_completed",
  "workflow.instance_cancelled",
  "task.completed",
  "task.reassigned",
  "task.escalated",
  "task.extension_requested",
  "protocol.version_submitted",
  "protocol.revision_started",
  "protocol.fee_verified",
  "protocol.fee_rejected",
  "form.signed",
];

export type LogEntry = {
  id: string;
  at: Date;
  kind: "Workflow" | "Release" | "Notification" | "Document";
  summary: string;
  actor: string;
  /** Set for generated documents so the logbook can open them in the viewer. */
  fileId?: string;
  fileMime?: string;
};

export async function protocolLogbook(userId: string, protocolId: string): Promise<LogEntry[]> {
  if (!(await canViewProtocol(userId, protocolId))) {
    throw new AppError("FORBIDDEN", "You cannot open this protocol.", 403);
  }
  const staff = await isCommitteeStaff(userId);
  return readTransaction(async (tx) => {
    await useAppSchema(tx);
    const [facts, events, notices, files, members] = await Promise.all([
      stepFacts(tx),
      tx.auditEvent.findMany({
        where: { protocolId, action: { in: LOG_ACTIONS } },
        orderBy: { occurredAt: "desc" },
        take: 400,
        include: { actor: { select: { id: true, displayName: true } } },
      }),
      tx.notification.findMany({
        where: { protocolId },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, title: true, type: true, createdAt: true, emailStatus: true, userId: true, user: { select: { displayName: true } } },
      }),
      tx.storedFile.findMany({
        where: { kind: { in: ["GENERATED_DOCX", "GENERATED_PDF"] }, protocolVersion: { protocolId } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          originalName: true,
          kind: true,
          mime: true,
          createdAt: true,
          audience: true,
          variant: true,
          formInstanceId: true,
          uploadedBy: { select: { id: true, displayName: true } },
        },
      }),
      tx.protocolMember.findMany({
        where: { protocolId, status: { not: "REMOVED" }, role: { in: ["REVIEWER", "PRIMARY_REVIEWER", "INDEPENDENT_CONSULTANT"] } },
        select: { userId: true },
      }),
    ]);
    // Proponents and advisers of a November protocol see a generated file only when its form is theirs to open.
    const allowed = new Map<string, boolean>();
    for (const file of files) {
      if (staff || !file.formInstanceId) continue;
      allowed.set(file.id, await fileAccessAllowed(tx, userId, file));
    }
    const reviewers = new Set(members.map((member) => member.userId).filter((id): id is string => Boolean(id)));
    const release = new Set(facts.releaseKeys);
    const actorName = (userIdOf: string | null | undefined, name: string | null | undefined) => {
      if (staff || !userIdOf || !reviewers.has(userIdOf)) return name || "System";
      return "Reviewer";
    };
    const entries: LogEntry[] = [
      ...events.map((event) => {
        const stepKey = diffText(event.diff, "stepKey");
        const released = event.action === "task.completed" && release.has(stepKey);
        return {
          id: event.id,
          at: event.occurredAt,
          kind: released ? "Release" as const : "Workflow" as const,
          summary: released ? `Decision released · ${facts.name(stepKey)}` : auditActionLabel(event.action),
          actor: actorName(event.actorUserId, event.actor?.displayName),
        };
      }),
      ...notices.map((notice) => ({
        id: notice.id,
        at: notice.createdAt,
        kind: "Notification" as const,
        summary: `${notice.title || notice.type}${notice.emailStatus === "SENT" ? " · emailed" : ""}`,
        actor: actorName(notice.userId, notice.user.displayName),
      })),
      ...visibleFiles(files, staff).filter((file) => allowed.get(file.id) !== false).map((file) => ({
        id: file.id,
        at: file.createdAt,
        kind: "Document" as const,
        summary: `${file.kind === "GENERATED_PDF" ? "PDF" : "Word file"} generated · ${file.originalName}`,
        actor: actorName(file.uploadedBy.id, file.uploadedBy.displayName),
        fileId: file.id,
        fileMime: file.mime,
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 400);
  });
}

/**
 * Staff see every generated file. Others see a STAFF copy never, and for a form released with an
 * audience, only its PROPONENT copy.
 */
function visibleFiles<T extends { audience: string | null; formInstanceId: string | null }>(files: T[], staff: boolean): T[] {
  if (staff) return files;
  const controlled = new Set(files.filter((file) => file.audience && file.formInstanceId).map((file) => file.formInstanceId));
  return files.filter((file) => {
    if (file.audience === "STAFF") return false;
    if (file.audience === "PROPONENT") return true;
    return !file.formInstanceId || !controlled.has(file.formInstanceId);
  });
}

function diffText(diff: unknown, key: string): string {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return "";
  const value = (diff as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}
