import "server-only";
import { cache } from "react";
import { parseGraph, type Step } from "@/lib/workflow/graph";
import type { ChecklistGroup, ChecklistItem, SubmissionChecklist } from "@/lib/protocols/checklist";
import { prisma } from "@/server/db";
import { protocolDetailsSchema } from "@/server/protocols/details";
import { intakeStateOf } from "@/server/intake/state";
import { RESEARCH_TYPE_GAP } from "@/lib/intake/gaps";
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
 * The leader's open proponent task and where submitting it sends the protocol: to the adviser
 * when the next step is the adviser's and the protocol has an active adviser, else to the REC.
 */
export async function proponentSubmitTarget(protocolId: string): Promise<{ taskId: string; to: "ADVISER" | "REC" } | null> {
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
    if (step?.assignee?.kind !== "PROTOCOL_LEADER") continue;
    const hasAdviser = (await prisma.protocolMember.count({ where: { protocolId, role: "ADVISER", status: "ACTIVE" } })) > 0;
    const next = graph.graph.transitions
      .filter((transition) => transition.from === step.key)
      .map((transition) => graph.graph.steps.find((item) => item.key === transition.to));
    const toAdviser = hasAdviser && next.some((item) => item?.assignee?.kind === "PROTOCOL_ADVISER");
    return { taskId: task.id, to: toAdviser ? "ADVISER" : "REC" };
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

  // Intake versions: the proponents answer the intake once; F-27, F-28, F-30, F-35, F-36 and F-38 are printed from it.
  const intake = working ? await intakeStateOf(working.id) : null;
  if (intake?.usesIntake) {
    const sections: { key: string; label: string; section: string }[] = [
      { key: "intake.scoping", label: "Scoping questions", section: "scoping" },
      { key: "intake.coi", label: "Conflict of interest", section: "coi" },
      { key: "intake.budget", label: "Budget (F-30)", section: "budget" },
      // Required exactly when the gaps ask for them: the first version, or a resubmission that carries F-35 and F-36 again.
      ...(intake.referencesRequired ? [{ key: "intake.references", label: "Page and line references (F-35, F-36)", section: "references" }] : []),
      ...(intake.actionPoints.length > 0 ? [{ key: "intake.actions", label: "Actions taken (F-38)", section: "actions" }] : []),
    ];
    // One item per researcher: agreed to both and signed F-27 and F-28. The submit check reads the same gaps.
    const researcherItems: ChecklistItem[] = intake.researchers.map((researcher) => {
      const gap = intake.gaps.find((entry) => entry.section === "agreements" && entry.memberId === researcher.memberId);
      return {
        key: `sign.${researcher.memberId}`,
        label: `${researcher.name}: agreed and signed ${(intake.signingCodes.length > 0 ? intake.signingCodes : ["F-27", "F-28"]).join(" and ")}`,
        done: !gap,
        hint: gap?.message ?? null,
        href: `${base}/intake#agreements`,
      };
    });
    groups.push({
      tab: "intake",
      label: "Intake",
      href: `${base}/intake`,
      items: [
        ...sections.map((item) => {
          const gap = intake.gaps.find((entry) => entry.section === item.section);
          return { key: item.key, label: item.label, done: !gap, hint: gap?.message ?? null, href: `${base}/intake#${item.section}` };
        }),
        ...researcherItems,
        // INTAKE-04: each return comment the proponents have not ticked Done yet.
        ...intake.gaps
          .filter((gap) => gap.section === "returnNotes")
          .map((gap) => ({ key: `revision.note.${gap.detail?.codes[0] ?? ""}`, label: gap.message.replace(/\.$/, ""), done: false, hint: gap.message, href: `${base}/intake#actions` })),
      ],
    });
    // The research type has its own item above, so it is not counted twice.
    const study = intake.gaps.filter((gap) => gap.section === "study" && gap.message !== RESEARCH_TYPE_GAP);
    const funding = intake.gaps.filter((gap) => gap.section === "funding");
    const detailsGroup = groups.find((group) => group.tab === "details");
    if (detailsGroup) {
      // On an intake version the proponents answer these on the Intake tab (Study, Funding and budget).
      for (const item of detailsGroup.items) item.href = `${base}/intake#study`;
      detailsGroup.items.push(
        {
          key: "details.study",
          label: "Duration, participants and site",
          done: study.length === 0,
          hint: study[0]?.message ?? null,
          href: `${base}/intake#study`,
        },
        {
          key: "details.funding",
          label: "Source of funds",
          done: funding.length === 0,
          hint: funding[0]?.message ?? null,
          href: `${base}/intake#funding`,
        },
      );
    }
  }

  const formItems: ChecklistItem[] = [];
  for (const form of step.forms ?? []) {
    if (!form.required || form.mode === "VIEW" || form.slot) continue;
    const listed = forms.find((item) => item.code === form.code);
    // On an intake version the forms printed from the intake are counted by the intake items above: F-27 and F-28 by the
    // researcher items, F-30 by the budget, F-35 and F-36 by the references, F-38 by the actions. Their own progress
    // checks the stored data for every role (the reviewers' columns too), so it never reads Complete for the proponents;
    // the submit check reads the bound values for the proponents' step, which the intake gaps already are.
    if (intake?.usesIntake && (form.code === "F-27" || form.code === "F-28" || listed?.intakeSourced)) continue;
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
