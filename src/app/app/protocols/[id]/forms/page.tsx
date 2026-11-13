import Link from "next/link";
import { FormsPreview } from "@/components/protocols/intake/forms-preview";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { TaskCommentList } from "@/components/workflow/task-comments";
import type { FormProgress } from "@/lib/protocols/format";
import { prisma } from "@/server/db";
import { GENERATED_FORMS, generatedFormList } from "@/server/intake/page";
import { usesIntake } from "@/server/intake/state";
import { listWorkingForms, protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";
import { protocolTaskComments } from "@/server/workflow/comments";

const TONE: Record<FormProgress, StatusTone> = {
  "Not started": "draft",
  "In progress": "info",
  Complete: "success",
  "Needs signatures": "warning",
};

export default async function ProtocolFormsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [header, forms, taskComments] = await Promise.all([
    protocolHeader(user.id, id),
    listWorkingForms(user.id, id),
    protocolTaskComments(user.id, id),
  ]);
  // Proponents and advisers of an intake protocol get the generated forms read-only: they answer
  // them on the Intake tab and never open editable copies of F-26, F-27, F-28, F-30, F-35 or F-36.
  const proponentView = !header.staff && (header.mine?.role === "PROPONENT" || header.mine?.role === "ADVISER");
  const version = header.working ?? header.shown;
  const intake = proponentView && version ? await usesIntake(prisma, version.id) : false;
  if (intake && version) {
    const generated = await generatedFormList(version.id);
    const others = forms.filter((form) => !(GENERATED_FORMS as readonly string[]).includes(form.code));
    return (
      <div className="rec-stack">
        <TaskCommentList comments={taskComments.comments} level="h2" />
        <section className="rec-card rec-stack" aria-labelledby="generated-heading">
          <div className="rec-card__head">
            <h2 id="generated-heading" className="heading">
              Forms
            </h2>
            <StatusBadge tone="info" label="Filled from the intake" />
          </div>
          <p className="body-sm rec-muted">
            These forms are filled from the <Link href={`/app/protocols/${id}/intake`}>Intake</Link> tab. Preview or print them here; change an answer on the Intake tab.
          </p>
          <FormsPreview protocolId={id} forms={generated} linkBack={false} />
        </section>
        {others.length > 0 ? (
          <ul className="rec-methods">
            {others.map((form) => (
              <li key={form.instanceId}>
                <Link href={`/app/protocols/${id}/forms/${form.instanceId}`} className="rec-card rec-proto-card">
                  <div className="rec-inline">
                    <span className="code">{form.code}</span>
                    <StatusBadge tone={TONE[form.progress]} label={form.progress} />
                  </div>
                  <h2 className="heading">{form.title}</h2>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rec-stack">
      <TaskCommentList comments={taskComments.comments} level="h2" />
      {!header.working ? (
        <p className="body">This version is submitted. Start a revision to edit forms.</p>
      ) : forms.length === 0 ? (
        <p className="body">
          No forms are required yet. REC Staff sets <span className="code">protocol.requiredForms</span> until the workflow chooses them.
        </p>
      ) : (
        <ul className="rec-methods">
          {forms.map((form) => (
            <li key={form.instanceId}>
              <Link href={`/app/protocols/${id}/forms/${form.instanceId}`} className="rec-card rec-proto-card">
                <div className="rec-inline">
                  <span className="code">{form.code}</span>
                  <StatusBadge tone={TONE[form.progress]} label={form.progress} />
                </div>
                <h2 className="heading">{form.title}</h2>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
