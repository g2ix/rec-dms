import { StatusBadge } from "@/components/ui/status-badge";
import { ActionForm } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { TaskCommentList } from "@/components/workflow/task-comments";
import { auditActionLabel } from "@/lib/audit-log";
import { dueState } from "@/lib/workflow/due";
import { formatManila } from "@/lib/time";
import { isCommitteeStaff } from "@/server/authz/staff";
import { claimTaskAction, completeTaskAction, reassignTaskAction, requestExtensionAction } from "@/server/workflow/actions";
import type { TaskComment } from "@/server/workflow/comments";
import { protocolFlow, reviewerOptions } from "@/server/workflow/read";
import { readRule } from "@/server/workflow/who";

const DUE = {
  overdue: { tone: "danger" as const, label: "Overdue" },
  soon: { tone: "warning" as const, label: "Due soon" },
  scheduled: null,
  none: null,
};

export async function ProtocolFlow({
  protocolId,
  userId,
  comments,
}: {
  protocolId: string;
  userId: string;
  comments: TaskComment[];
}) {
  const flow = await protocolFlow(protocolId, userId);
  if (!flow) return null;
  const staff = await isCommitteeStaff(userId);
  return (
    <section className="rec-stack">
      <h2 className="heading">Review</h2>
      <p className="body-sm rec-muted">
        {flow.instance.version.definition.name} · version <span className="code">{flow.instance.version.number}</span> · {flow.instance.status}
      </p>
      {flow.current.length === 0 ? (
        <p className="body">This pass has no open step.</p>
      ) : (
        flow.current.map((step) => <p key={step.key} className="body">{step.name}</p>)
      )}
      {flow.open.map((task) => {
        const due = DUE[dueState(task.dueAt)];
        return (
          <article key={task.id} className="rec-card rec-stack">
            <h3 className="subheading">{task.title}</h3>
            <p className="body-sm">{task.assigneeName ?? "Unclaimed"}</p>
            {task.dueAt ? <p className="body-sm">{formatManila(task.dueAt, "d MMM yyyy, h:mm a")}</p> : null}
            {due ? <StatusBadge tone={due.tone} label={due.label} /> : null}
          </article>
        );
      })}
      {flow.extension?.step ? (
        <ActionForm
          action={requestExtensionAction}
          className="rec-card rec-stack"
          submitLabel="Request extension"
          busyLabel="Requesting…"
          variant="secondary"
        >
          <p className="body-sm">Ask the Panel Chair for a later revision deadline. The request stays open until they approve a new date or deny it.</p>
          <input type="hidden" name="instanceId" value={flow.extension.instanceId} />
          <input type="hidden" name="protocolId" value={protocolId} />
        </ActionForm>
      ) : null}
      {flow.mine.map((task) =>
        task.step && task.step.type !== "WAIT_PROPONENT" ? (
          <TaskForm
            key={task.id}
            protocolId={protocolId}
            taskId={task.id}
            step={task.step}
            side={task.side}
            unclaimed={task.assigneeUserId == null}
          />
        ) : null,
      )}
      {staff
        ? flow.open.map((task) => (
            <Reassign key={`reassign-${task.id}`} protocolId={protocolId} taskId={task.id} ruleRole={roleOf(task.candidateRule)} />
          ))
        : null}
      <TaskCommentList comments={comments} level="h3" />
      <h3 className="subheading">History</h3>
      {flow.history.length === 0 ? (
        <p className="body-sm rec-muted">No workflow events yet.</p>
      ) : (
        <ol className="rec-methods">
          {flow.history.map((event) => (
            <li key={event.id}>
              <p className="body-sm">
                {auditActionLabel(event.action)}
                {event.actorName ? ` · ${event.actorName}` : ""} · {formatManila(event.occurredAt, "d MMM yyyy, h:mm a")}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function roleOf(value: unknown): string | null {
  const rule = readRule(value);
  if (rule?.kind === "ROLE" || rule?.kind === "PANEL_ROLE_OF_PROTOCOL") return rule.role;
  return null;
}

async function TaskForm({
  protocolId,
  taskId,
  step,
  side,
  unclaimed,
}: {
  protocolId: string;
  taskId: string;
  step: NonNullable<Awaited<ReturnType<typeof protocolFlow>>>["mine"][number]["step"];
  side: NonNullable<Awaited<ReturnType<typeof protocolFlow>>>["mine"][number]["side"];
  unclaimed: boolean;
}) {
  if (!step) return null;
  const outcomes = side?.outcomes ?? step.outcomes;
  const reviewers = !side && step.assignReviewers ? await reviewerOptions(protocolId, step.assignReviewers.roles) : [];
  if (unclaimed) {
    return (
      <form action={claimTaskAction} className="rec-card rec-stack">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="protocolId" value={protocolId} />
        <BusyButton type="submit" variant="primary">
          Claim {step.name}
        </BusyButton>
      </form>
    );
  }
  return (
    <ActionForm
      action={completeTaskAction}
      className="rec-card rec-stack"
      submitLabel={`Complete ${step.name}`}
      busyLabel="Completing…"
    >
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="protocolId" value={protocolId} />
      {outcomes && outcomes.length > 0 ? (
        <fieldset className="rec-stack">
          <legend className="label">Outcome</legend>
          {outcomes.map((outcome) => (
            <label key={outcome.key} className="rec-choice">
              <input type="radio" name="outcome" value={outcome.key} required />
              <span>{outcome.label}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {side?.effect === "SET_DUE" ? (
        <label className="rec-field">
          <span className="label">New due date</span>
          <input className="rec-input" type="date" name="newDueAt" />
        </label>
      ) : null}
      {step.capture?.meetingDate ? (
        <label className="rec-field">
          <span className="label">Meeting date</span>
          <input className="rec-input" type="date" name="meetingDate" required />
        </label>
      ) : null}
      {step.assignReviewers && !side ? (
        <fieldset className="rec-stack">
          <legend className="label">
            Reviewers (
            {step.assignReviewers.max != null
              ? `${step.assignReviewers.min} to ${step.assignReviewers.max}`
              : `at least ${step.assignReviewers.min}`}
            )
          </legend>
          {reviewers.length === 0 ? <p className="body-sm">No one holding those roles is free of a conflict.</p> : null}
          {reviewers.map((reviewer) => (
            <label key={reviewer.id} className="rec-choice">
              <input type="checkbox" name="reviewerUserId" value={reviewer.id} />
              <span>
                {reviewer.name} · {reviewer.openTasks} open {reviewer.openTasks === 1 ? "task" : "tasks"}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <label className="rec-field rec-field--wide">
        <span className="label">Comment</span>
        <textarea className="rec-input" name="comment" rows={3} />
      </label>
    </ActionForm>
  );
}

async function Reassign({ protocolId, taskId, ruleRole }: { protocolId: string; taskId: string; ruleRole: string | null }) {
  const people = ruleRole ? await reviewerOptions(protocolId, [ruleRole]) : [];
  if (people.length === 0) return null;
  return (
    <form action={reassignTaskAction} className="rec-actions">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="protocolId" value={protocolId} />
      <label className="rec-field">
        <span className="label">Reassign to</span>
        <select className="rec-select" name="userId" required>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} · {person.openTasks} open
            </option>
          ))}
        </select>
      </label>
      <label className="rec-field">
        <span className="label">Reason</span>
        <input className="rec-input" name="reason" required />
      </label>
      <BusyButton type="submit">Reassign</BusyButton>
    </form>
  );
}
