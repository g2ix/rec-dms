# M07 — Configurable workflow engine and builder

Read first: `docs/SPEC.md` → "Configurable workflow engine" (all), "Data model" (Workflow group), "Protocol lifecycle and collaboration" (Statuses). This is the core milestone; take time on the plan.

## Goal
The review process runs from a versioned graph stored in Postgres. Admins change steps, assignees, deadlines and routing in a builder; in-flight protocols keep their version.

## Graph format (`src/lib/workflow/graph.ts`, Zod)
```ts
WorkflowGraph = {
  startStep: string,
  steps: Step[],
  transitions: Transition[]
}
Step = {
  key: string, name: string,
  type: 'TASK'|'PARALLEL_TASK'|'DECISION'|'SIGNATURE'|'AUTO'|'WAIT_PROPONENT'|'END',
  assignee?: AssigneeRule,              // not for AUTO / END
  parallel?: { completeWhen: 'ALL'|'ANY'|{ atLeast: number } },
  outcomes?: { key: string, label: string }[],   // DECISION (and optional for TASK, e.g. ACCEPT / RETURN)
  forms?: { code: string, mode: 'FILL'|'SIGN'|'VIEW', perAssignee?: boolean, required: boolean }[],
  uploads?: { kind: FileKind, required: boolean }[],
  actions?: AutoAction[],              // AUTO steps, and onEnter/onExit hooks for any step
  setFields?: { path: 'protocol.reviewType'|'protocol.status'|'protocol.panelId', from: 'outcome'|'formField', field?: string }[],
  assignReviewers?: { roles: RoleKey[], min: number, max: number },  // step where the assignee picks reviewers
  deadline?: { amount: number, unit: 'HOURS'|'CALENDAR_DAYS'|'WORKING_DAYS', remindBefore?: Duration[], escalateTo?: AssigneeRule },
  statusLabel?: string,                // protocol status while this step is open, e.g. "Under Review"
  notify?: { onAssigned?: TemplateKey, onDueSoon?: TemplateKey, onOverdue?: TemplateKey, onCompleted?: TemplateKey, cc?: AssigneeRule[] }
}
AssigneeRule =
  | { kind: 'ROLE', role: RoleKey }                      // anyone holding a global role (first to claim)
  | { kind: 'PANEL_ROLE_OF_PROTOCOL', role: RoleKey }     // e.g. PANEL_CHAIR of the protocol's panel
  | { kind: 'PROTOCOL_LEADER' } | { kind: 'PROTOCOL_PROPONENTS' } | { kind: 'PROTOCOL_ADVISER' }
  | { kind: 'ASSIGNED_IN_STEP', stepKey: string }         // reviewers chosen in an earlier step
  | { kind: 'USER', userId: string }
Transition = { from: string, to: string, when?: JsonLogic, label?: string, priority?: number }
AutoAction = { kind: 'ASSIGN_PROTOCOL_CODE'|'SNAPSHOT_VERSION'|'GENERATE_DOCUMENTS'|'NOTIFY'|'START_WORKFLOW', params?: Json }
```
JsonLogic data available to `when`: `{ outcome, protocol: {reviewType, panelId, …}, forms: {"F-31": {...data}}, step: {key} }`.

## Data model
- `WorkflowDefinition`: id, key (unique, e.g. `INITIAL_SUBMISSION`), name, submissionType.
- `WorkflowVersion`: id, definitionId, number, status `DRAFT | PUBLISHED | ARCHIVED`, graph Json, notes, publishedById, publishedAt. One PUBLISHED per definition.
- `WorkflowInstance`: id, versionId, protocolId, protocolVersionId, status `RUNNING | COMPLETED | CANCELLED`, currentStepKeys String[], startedAt, endedAt, parentInstanceId (for resubmission chains).
- `Task`: id, instanceId, stepKey, assigneeUserId (nullable while unclaimed), candidateRule Json, status `OPEN | CLAIMED | COMPLETED | CANCELLED | REASSIGNED`, outcome, comment, dueAt, remindedAt Json, escalatedAt, completedAt, completedById.
- `Holiday`: date (unique), name.
- `Job` (outbox): id, kind, payload, runAt, attempts, lastError, doneAt.

## Tasks
1. `validateGraph(graph)`: Zod + structural checks — startStep exists; every non-END step has an exit; every DECISION outcome has a transition; no unreachable steps; `ASSIGNED_IN_STEP` refers to an earlier step with `assignReviewers`; form codes exist as PUBLISHED definitions; WAIT_PROPONENT has a deadline.
2. Engine `src/server/workflow/engine.ts` (pure core + DB adapter, heavily tested):
   - `startInstance(definitionKey, protocolId, protocolVersionId)` — pins the current PUBLISHED version.
   - `enterStep(tx, instance, stepKey)` — run onEnter/AUTO actions, resolve assignees, create tasks, compute `dueAt` (working-day calculator skipping weekends + `Holiday`, timezone Asia/Manila), set protocol status label, create form instances needed (perAssignee → one per reviewer), queue notifications as `Job`s.
   - `completeTask(taskId, { outcome, comment })` — authorize assignee; check required forms complete and signed for that assignee; record; if step complete (parallel rule), evaluate transitions in priority order, first match wins; no match → error `NO_TRANSITION` (and the validator should have prevented it).
   - `claimTask`, `reassignTask(taskId, userId, reason)` (REC Staff / admin), `cancelInstance`.
   - Every operation in one transaction + audit events (`workflow.step_entered`, `task.completed`, `task.reassigned`, …).
   - Idempotency: completing an already-completed task returns the existing result.
3. Replace M05's temporary `submitVersion` gating with the workflow: "Submit" = complete the proponent's start TASK; required forms/uploads now come from the step definition.
4. Reviewer assignment UI for steps with `assignReviewers`: pick users holding the allowed roles, filtered by COI rule, show their current open-task load.
5. Task inbox `/app/tasks`: "All my tasks" plus per-role filters (from the role switcher), due date with color (due soon amber, overdue red), open protocol at the step's forms.
6. Protocol page shows the current step(s), assignee(s), due date, and the instance history (step entered/completed with who and when).
7. Builder `/admin/workflows`:
   - List definitions and versions; "New draft from published".
   - Editor: left = step list with forms per step (add/edit/delete/reorder), right = a read-only graph view rendered with React Flow (`@xyflow/react`) auto-laid out with `dagre`. Selecting a node opens its step form (type, assignee rule picker, deadline, forms, outcomes, notifications). Transitions edited in a table (from, to, condition builder with a JSON fallback).
   - "Validate" shows errors on nodes; "Publish" requires validation pass; "Simulate": choose outcomes step by step against a fake protocol to see the path and computed due dates.
8. Working-day calculator with tests (weekends, holidays, crossing month end, Manila timezone at midnight).
9. Admin `/admin/holidays` CRUD.

## Acceptance criteria
- Build (in tests, not seed) a 5-step graph with a DECISION branch, a PARALLEL_TASK of 2 reviewers with `completeWhen: ALL`, and a WAIT_PROPONENT loop. Run it end to end in an integration test.
- Publishing v2 while an instance runs on v1: the running instance continues on v1; a new protocol starts on v2.
- The validator rejects: unreachable step, missing outcome transition, unknown form code.
- A reviewer who is a proponent on the protocol cannot be assigned.
- Engine unit test coverage ≥ 90% lines.

## Do not
- Seed the USC REC workflows (M08). Send real emails (M09) — just enqueue jobs.
