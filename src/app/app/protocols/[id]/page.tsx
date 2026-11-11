import { FeesSection } from "@/components/protocols/fees-section";
import { RecentActivity, StageTrack, TeamCard, stageOf } from "@/components/protocols/overview-cards";
import { SubmitStepForm } from "@/components/protocols/submit-step-card";
import { WorkflowMigration } from "@/components/workflow/workflow-migration";
import { ProtocolFlow } from "@/components/workflow/protocol-flow";
import { ReturnBanner, TaskCommentList } from "@/components/workflow/task-comments";
import { ActionForm } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { isReady, submitSummary, type SubmissionChecklist } from "@/lib/protocols/checklist";
import { slotsOf } from "@/lib/workflow/graph";
import { getSubmissionChecklist } from "@/server/protocols/checklist";
import { roster } from "@/server/protocols/read";
import { protocolTaskComments } from "@/server/workflow/comments";
import { completeTaskAction } from "@/server/workflow/actions";
import { protocolFlow } from "@/server/workflow/read";
import { startRevisionAction, submitVersionAction } from "@/server/protocols/actions";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

type Flow = NonNullable<Awaited<ReturnType<typeof protocolFlow>>>;

function sentenceCase(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** A proponent task the step card can complete on its own: no outcome to choose and nothing extra to capture. */
function plainTask(flow: Flow | null, stepName: string) {
  return (
    flow?.mine.find(
      (task) =>
        task.kind === "MAIN" &&
        task.step?.name === stepName &&
        task.assigneeUserId != null &&
        !task.step.outcomes?.length &&
        !task.step.capture &&
        !task.step.assignReviewers &&
        slotsOf(task.step).length === 0,
    ) ?? null
  );
}

export default async function ProtocolOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const [header, people, flow, taskComments, checklist] = await Promise.all([
    protocolHeader(user.id, id),
    roster(user.id, id),
    protocolFlow(id, user.id),
    protocolTaskComments(user.id, id),
    getSubmissionChecklist(user.id, id),
  ]);
  const leader = header.mine?.isLeader && header.mine.role === "PROPONENT" && header.mine.status === "ACTIVE";
  const workflowRunning = flow?.instance.status === "RUNNING";
  const proponentView = !header.staff && (header.mine?.role === "PROPONENT" || header.mine?.role === "ADVISER");
  const task = checklist ? plainTask(flow, checklist.stepName) : null;
  // Proponents get the step card while their step is open. Everyone else keeps the full workflow panel.
  const stepCard = proponentView && checklist && !flow?.extension && (task || !flow?.mine.length) ? checklist : null;

  const main = (
    <div className="rec-stack">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <ReturnBanner reason={taskComments.returnReason} />
      {stepCard ? (
        <StepCard
          protocolId={id}
          status={header.protocol.status}
          checklist={stepCard}
          task={task}
          canSubmit={Boolean(leader)}
        />
      ) : (
        <ProtocolFlow protocolId={id} userId={user.id} comments={taskComments.comments} />
      )}
      {stepCard ? <TaskCommentList comments={taskComments.comments} level="h2" /> : null}
      <FeesSection protocolId={id} userId={user.id} />
      <WorkflowMigration protocolId={id} userId={user.id} />
      {leader && header.working && !workflowRunning ? (
        <ActionForm action={submitVersionAction} className="rec-stack" submitLabel="Submit version" busyLabel="Submitting…">
          <input type="hidden" name="protocolId" value={id} />
        </ActionForm>
      ) : null}
      {leader && !header.working ? (
        <form action={startRevisionAction}>
          <input type="hidden" name="protocolId" value={id} />
          <BusyButton type="submit">{header.protocol.versions.length === 0 ? "Start the working version" : "Start a revision"}</BusyButton>
        </form>
      ) : null}
      {!leader && !stepCard ? <p className="body-sm rec-muted">Only the project leader can submit a version.</p> : null}
      <TeamCard protocolId={id} members={people.members} viewerId={user.id} />
      <RecentActivity protocolId={id} viewerId={user.id} />
    </div>
  );

  return main;
}

function StepCard({
  protocolId,
  status,
  checklist,
  task,
  canSubmit,
}: {
  protocolId: string;
  status: string;
  checklist: SubmissionChecklist;
  task: ReturnType<typeof plainTask>;
  canSubmit: boolean;
}) {
  const initial = /^submit/i.test(checklist.stepName);
  return (
    <section className="rec-card rec-step" aria-labelledby="step-heading">
      <div className="rec-step__band">
        <StageTrack current={stageOf(status)} />
      </div>
      <div className="rec-step__body rec-stack">
        <div className="rec-stack rec-step__intro">
          <h2 id="step-heading" className="heading">
            Your step: {sentenceCase(checklist.stepName)}
          </h2>
          <p className="body-sm rec-muted">
            Finish the items under &ldquo;Before you can submit&rdquo;, then send it to REC Staff
            {initial ? " for screening" : ""}. You can still edit until you submit.
          </p>
        </div>
        {task && canSubmit ? (
          <SubmitStepForm
            action={completeTaskAction}
            taskId={task.id}
            protocolId={protocolId}
            ready={isReady(checklist)}
            summary={submitSummary(checklist)}
            submitLabel={initial ? "Submit for screening" : "Send to REC Staff"}
          />
        ) : (
          <p className="body-sm rec-muted">Only the project leader can submit. You can still help prepare the forms and uploads.</p>
        )}
      </div>
    </section>
  );
}
