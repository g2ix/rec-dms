import "server-only";
import { cache } from "react";
import { parseGraph, type Step } from "@/lib/workflow/graph";
import type { ChecklistGroup, ChecklistItem, SubmissionChecklist } from "@/lib/protocols/checklist";
import { prisma } from "@/server/db";
import { protocolDetailsSchema } from "@/server/protocols/details";
import { listWorkingForms, requireView } from "@/server/protocols/read";

const UPLOAD_LABEL: Record<string, string> = {
  MANUSCRIPT: "Manuscript",
  COVER_LETTER: "Cover letter",
  FEE_RECEIPT: "Fee receipt",
  SUPPORTING: "Supporting file",
};

/**
 * The open proponent step: a main task for the project leader on the latest workflow pass.
 * Its forms and uploads are what the engine checks before the step can be completed.
 */
async function proponentStep(protocolId: string): Promise<Step | null> {
  const instance = await prisma.workflowInstance.findFirst({
    where: { protocolId, status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { version: true, tasks: { where: { status: { in: ["OPEN", "CLAIMED"] }, kind: "MAIN" } } },
  });
  if (!instance) return null;
  const graph = parseGraph(instance.version.graph);
  if (!graph.ok) return null;
  for (const task of instance.tasks) {
    const step = graph.graph.steps.find((item) => item.key === task.stepKey);
    if (step?.assignee?.kind === "PROTOCOL_LEADER") return step;
  }
  return null;
}

/**
 * What is still missing before the project leader can complete the current proponent step.
 * One source for the Overview checklist, the tab count pills and the submit card.
 * Returns null when no proponent step is open, so nothing is waiting on the proponents.
 */
export const getSubmissionChecklist = cache(async (userId: string, protocolId: string): Promise<SubmissionChecklist | null> => {
  await requireView(userId, protocolId);
  const step = await proponentStep(protocolId);
  if (!step) return null;
  const base = `/app/protocols/${protocolId}`;
  const [protocol, forms, working] = await Promise.all([
    prisma.protocol.findUniqueOrThrow({ where: { id: protocolId }, include: { leader: { select: { status: true } } } }),
    listWorkingForms(userId, protocolId),
    prisma.protocolVersion.findFirst({ where: { protocolId, state: "WORKING" }, select: { id: true } }),
  ]);
  const accountApproved = protocol.leader.status === "ACTIVE";

  const groups: ChecklistGroup[] = [
    {
      tab: "account",
      label: "Account",
      href: null,
      items: [
        {
          key: "account.approved",
          label: "Approved by REC Staff",
          done: accountApproved,
          hint: accountApproved ? null : "Waiting for the office. Nothing to do on your side.",
          href: null,
        },
      ],
    },
  ];

  const details = protocolDetailsSchema.shape;
  groups.push({
    tab: "details",
    label: "Details",
    href: `${base}/details`,
    items: [
      { key: "details.title", label: "Protocol title", done: details.title.safeParse(protocol.title).success, hint: null, href: `${base}/details` },
      {
        key: "details.institution",
        label: "Institution",
        done: details.institution.safeParse(protocol.institution).success,
        hint: null,
        href: `${base}/details`,
      },
      {
        key: "details.researchType",
        label: "Research type",
        done: details.researchTypeCodes.safeParse(protocol.researchTypeCodes).success,
        hint: null,
        href: `${base}/details`,
      },
    ],
  });

  const formItems: ChecklistItem[] = [];
  for (const form of step.forms ?? []) {
    if (!form.required || form.mode === "VIEW" || form.slot) continue;
    const listed = forms.find((item) => item.code === form.code);
    const progress = listed?.progress ?? "Not started";
    formItems.push({
      key: `forms.${form.code}`,
      label: listed ? `${form.code} · ${listed.title}` : form.code,
      done: progress === "Complete",
      hint: progress === "Complete" ? null : progress === "Needs signatures" ? "Needs signatures" : progress,
      href: listed ? `${base}/forms/${listed.instanceId}` : `${base}/forms`,
    });
  }
  if (formItems.length > 0) groups.push({ tab: "forms", label: "Forms", href: `${base}/forms`, items: formItems });

  const required = (step.uploads ?? []).filter((upload) => upload.required);
  if (required.length > 0) {
    const files = working
      ? await prisma.storedFile.findMany({
          where: { protocolVersionId: working.id, kind: { in: required.map((upload) => upload.kind) } },
          select: { kind: true },
        })
      : [];
    const have = new Set(files.map((file) => file.kind));
    groups.push({
      tab: "uploads",
      label: "Uploads",
      href: `${base}/uploads`,
      items: required.map((upload) => ({
        key: `uploads.${upload.kind}`,
        label: UPLOAD_LABEL[upload.kind] ?? upload.kind,
        done: have.has(upload.kind),
        hint: null,
        href: `${base}/uploads`,
      })),
    });
  }

  const all = groups.flatMap((group) => group.items);
  return {
    stepName: step.name,
    groups,
    done: all.filter((item) => item.done).length,
    total: all.length,
    accountApproved,
  };
});
