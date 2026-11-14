import "server-only";
import { onProponentSide } from "@/lib/workflow/blinding";
import { parseGraph, type WorkflowGraph } from "@/lib/workflow/graph";
import { isReleaseStep, returnsToProponent } from "@/lib/workflow/review-stage";
import { isCommitteeStaff } from "@/server/authz/staff";
import { prisma } from "@/server/db";
import { requireView } from "@/server/protocols/read";
import { NOTE_ROLE_LABEL, noteRoleOf } from "@/server/revision/notes";
import { formAccess } from "@/server/revision/visibility";

export type HistoryEvent = { at: Date; label: string; by: string };
export type HistoryForm = { instanceId: string; code: string; title: string; released: boolean };
export type HistoryVersion = { id: string; number: number; label: string; state: string; events: HistoryEvent[]; forms: HistoryForm[] };

/**
 * Version 1 → returned → version 2 → … → decision, each version with its read-only forms.
 * Proponents and advisers see only what the visibility rule lets them open, and who acted as a
 * role ("Panel", "REC Staff", "Adviser"), never a reviewer. Committee members see names.
 */
export async function versionHistory(userId: string, protocolId: string): Promise<HistoryVersion[]> {
  await requireView(userId, protocolId);
  const [versions, members, staff] = await Promise.all([
    prisma.protocolVersion.findMany({ where: { protocolId }, orderBy: { number: "asc" } }),
    prisma.protocolMember.findMany({ where: { protocolId }, select: { userId: true, role: true, status: true } }),
    isCommitteeStaff(userId),
  ]);
  const proponentSide = onProponentSide(members, userId);
  const names = !proponentSide && staff;
  const instances = await prisma.workflowInstance.findMany({
    where: { protocolId },
    include: {
      version: { select: { graph: true } },
      tasks: { where: { status: "COMPLETED", kind: "MAIN" }, orderBy: { completedAt: "asc" }, include: { completedBy: { select: { displayName: true } } } },
    },
  });
  const out: HistoryVersion[] = [];
  for (const version of versions) {
    const events: HistoryEvent[] = [];
    for (const instance of instances.filter((item) => item.protocolVersionId === version.id)) {
      const parsed = parseGraph(instance.version.graph);
      if (!parsed.ok) continue;
      const graph = parsed.graph;
      const released = instance.tasks.some((task) => isReleaseStep(graph.steps.find((step) => step.key === task.stepKey)));
      for (const task of instance.tasks) {
        if (!task.completedAt || !task.stepKey) continue;
        const step = graph.steps.find((item) => item.key === task.stepKey);
        if (!step) continue;
        const who = (role: string) => (names && task.completedBy?.displayName ? `${task.completedBy.displayName} (${role})` : role);
        if (task.stepKey === graph.startStep) {
          events.push({ at: task.completedAt, label: "Submitted", by: names && task.completedBy?.displayName ? task.completedBy.displayName : "Proponents" });
        } else if (returnsToProponent(graph, task.stepKey, task.outcome)) {
          const role = NOTE_ROLE_LABEL[noteRoleOf(step)];
          events.push({ at: task.completedAt, label: `Returned by the ${role}`, by: who(role) });
        } else if (step.assignee?.kind === "PROTOCOL_ADVISER") {
          events.push({ at: task.completedAt, label: "Forwarded to REC by the adviser", by: who("Adviser") });
        } else if (isReleaseStep(step)) {
          const decision = lastDecision(graph, instance.tasks);
          events.push({ at: task.completedAt, label: decision ? `Decision released: ${decision}` : "Decision released", by: who("REC Staff") });
        } else if (!proponentSide && step.type === "DECISION" && (released || staff)) {
          const outcome = step.outcomes?.find((item) => item.key === task.outcome)?.label ?? task.outcome ?? "";
          events.push({ at: task.completedAt, label: `${step.name}: ${outcome}`, by: who("Panel") });
        }
      }
    }
    if (version.state === "WORKING" && events.length === 0) events.push({ at: version.createdAt, label: "Being prepared", by: "Proponents" });
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    const copies = await prisma.formInstance.findMany({
      where: { ownerType: "PROTOCOL_VERSION", ownerId: version.id, filledByMemberId: null },
      include: { formDefinition: { select: { code: true, title: true } } },
    });
    const forms: HistoryForm[] = [];
    for (const copy of copies) {
      const access = await formAccess(prisma, userId, copy.id);
      if (access.kind === "denied") continue;
      forms.push({ instanceId: copy.id, code: copy.formDefinition.code, title: copy.formDefinition.title, released: access.kind === "released" });
    }
    forms.sort((a, b) => a.code.localeCompare(b.code));
    out.push({ id: version.id, number: version.number, label: version.label, state: version.state, events, forms });
  }
  return out;
}

function lastDecision(graph: WorkflowGraph, tasks: { stepKey: string | null; outcome: string | null }[]): string | null {
  for (const task of [...tasks].reverse()) {
    const step = graph.steps.find((item) => item.key === task.stepKey);
    if (step?.type !== "DECISION" || !task.outcome) continue;
    return step.outcomes?.find((item) => item.key === task.outcome)?.label ?? task.outcome;
  }
  return null;
}
