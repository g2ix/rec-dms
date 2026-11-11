import { StatusBadge } from "@/components/ui/status-badge";
import { ActionForm } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { TaskCommentList } from "@/components/workflow/task-comments";
import { auditActionLabel } from "@/lib/audit-log";
import { dueState } from "@/lib/workflow/due";
import { formatManila } from "@/lib/time";
import { isCommitteeStaff } from "@/server/authz/staff";
import { manilaDay } from "@/lib/workflow/calendar";
import { nextMeeting, parseMeetingSchedule, ruleFor } from "@/lib/reports/meetings";
import { slotsOf } from "@/lib/workflow/graph";
import { prisma } from "@/server/db";
import { settingValue } from "@/server/effective";
import { claimTaskAction, completeTaskAction, declareConflictAction, reassignTaskAction, requestExtensionAction } from "@/server/workflow/actions";
import type { TaskComment } from "@/server/workflow/comments";
import { protocolFlow, reviewerOptions, slotReviewerOptions } from "@/server/workflow/read";
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
          <div key={task.id} className="rec-stack">
            <TaskForm protocolId={protocolId} task={task} unclaimed={task.assigneeUserId == null} />
            {task.canDeclareConflict && task.assigneeUserId ? <ConflictForm protocolId={protocolId} taskId={task.id} /> : null}
          </div>
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

type MineTask = NonNullable<Awaited<ReturnType<typeof protocolFlow>>>["mine"][number];

async function meetingDefault(protocolId: string): Promise<string | undefined> {
  const protocol = await prisma.protocol.findUnique({ where: { id: protocolId }, select: { panel: { select: { code: true } } } });
  const rule = ruleFor(parseMeetingSchedule(await settingValue(prisma, "meetings.schedule")), protocol?.panel?.code);
  return rule ? nextMeeting(manilaDay(new Date()), rule) : undefined;
}

async function TaskForm({ protocolId, task, unclaimed }: { protocolId: string; task: MineTask; unclaimed: boolean }) {
  const step = task.step;
  if (!step) return null;
  const side = task.side;
  const redesignate = task.redesignate;
  const outcomes = redesignate ? [] : (side?.outcomes ?? step.outcomes);
  const slots = !side && !redesignate ? slotsOf(step) : [];
  const roles = step.assignReviewers?.roles ?? [];
  const reviewers = !side && !redesignate && step.assignReviewers && slots.length === 0 ? await reviewerOptions(protocolId, roles) : [];
  const slotOptions = await Promise.all(slots.map(async (slot) => ({ slot, people: await slotReviewerOptions(protocolId, slot) })));
  const redesignateOptions = redesignate && task.slot ? await slotReviewerOptions(protocolId, task.slot) : [];
  const meetingDay = step.capture?.meetingDate && !side ? await meetingDefault(protocolId) : undefined;
  const title = redesignate ? "Re-designate the reviewer" : side?.name ?? step.name;
  if (unclaimed) {
    return (
      <form action={claimTaskAction} className="rec-card rec-stack">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="protocolId" value={protocolId} />
        <BusyButton type="submit" variant="primary">
          Claim {title}
        </BusyButton>
      </form>
    );
  }
  return (
    <ActionForm action={completeTaskAction} className="rec-card rec-stack" submitLabel={`Complete ${title}`} busyLabel="Completing…">
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="protocolId" value={protocolId} />
      {task.slot && !redesignate ? <p className="body-sm">Your slot: {task.slot.label}</p> : null}
      {task.reviewDueDate ? <p className="body-sm">Review due: {task.reviewDueDate}</p> : null}
      {task.noteToReviewers ? (
        <p className="body-sm">
          <span className="label">Note from the chair</span> {task.noteToReviewers}
        </p>
      ) : null}
      {outcomes && outcomes.length > 0 ? (
        <fieldset className="rec-stack">
          <legend className="label">Outcome</legend>
          {outcomes.map((outcome) => (
            <label key={outcome.key} className="rec-choice">
              <input type="radio" name="outcome" value={outcome.key} required />
              <span>
                {outcome.label}
                {outcome.requiresComment ? " (give the reason in the comment)" : ""}
              </span>
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
      {step.capture?.meetingDate && !side && !redesignate ? (
        <label className="rec-field">
          <span className="label">Meeting date</span>
          <input className="rec-input" type="date" name="meetingDate" defaultValue={meetingDay} required />
        </label>
      ) : null}
      {redesignate ? (
        <label className="rec-field">
          <span className="label">New reviewer{task.slot ? ` · ${task.slot.label}` : ""}</span>
          <select className="rec-select" name={task.slot ? `reviewerSlot:${task.slot.key}` : "reviewerUserId"} required>
            {redesignateOptions.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.detail ? ` · ${person.detail}` : ""} · {GROUP_LABEL[person.group]} · {person.openTasks} open
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {slotOptions.map(({ slot, people }) => (
        <label key={slot.key} className="rec-field">
          <span className="label">{slot.label}</span>
          {people.length === 0 ? <span className="rec-field__help">No one eligible for this slot is free of a conflict.</span> : null}
          <select className="rec-select" name={`reviewerSlot:${slot.key}`} defaultValue="">
            <option value="">Choose…</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.detail ? ` · ${person.detail}` : ""} · {GROUP_LABEL[person.group]} · {person.openTasks} open
              </option>
            ))}
          </select>
          {slot.forms?.length ? <span className="rec-field__help">Fills {slot.forms.join(", ")}.</span> : null}
        </label>
      ))}
      {step.assignReviewers && !side && !redesignate && slots.length === 0 ? (
        <fieldset className="rec-stack">
          <legend className="label">
            Reviewers (
            {step.assignReviewers.max != null
              ? `${step.assignReviewers.min ?? 1} to ${step.assignReviewers.max}`
              : `at least ${step.assignReviewers.min ?? 1}`}
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
      {step.capture?.reviewDueDate && !side && !redesignate ? (
        <label className="rec-field">
          <span className="label">Review due date</span>
          <input className="rec-input" type="date" name="reviewDueDate" />
        </label>
      ) : null}
      {step.capture?.noteToReviewers && !side && !redesignate ? (
        <label className="rec-field rec-field--wide">
          <span className="label">Note to reviewers</span>
          <textarea className="rec-input" name="noteToReviewers" rows={3} />
          <span className="rec-field__help">Shown on the reviewers&rsquo; tasks and in their assignment email.</span>
        </label>
      ) : null}
      {step.feeOverride && !side && !redesignate ? (
        <label className="rec-field rec-field--wide">
          <span className="label">Reason to release with the bill open (REC Staff)</span>
          <input className="rec-input" name="feeOverrideReason" />
          <span className="rec-field__help">Needed only when the bill for this review is not paid in full. The bill stays open.</span>
        </label>
      ) : null}
      <label className="rec-field rec-field--wide">
        <span className="label">Comment</span>
        <textarea className="rec-input" name="comment" rows={3} />
      </label>
    </ActionForm>
  );
}

const GROUP_LABEL = { panel: "This panel", alternate: "Alternate", other: "Other panel" } as const;

function ConflictForm({ protocolId, taskId }: { protocolId: string; taskId: string }) {
  return (
    <ActionForm action={declareConflictAction} className="rec-card rec-stack" submitLabel="Declare a conflict of interest" busyLabel="Recording…" variant="secondary">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="protocolId" value={protocolId} />
      <p className="body-sm">If you have a conflict of interest, the task moves to the next person and REC Staff are told.</p>
      <label className="rec-field rec-field--wide">
        <span className="label">Reason</span>
        <textarea className="rec-input" name="reason" rows={2} required />
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
