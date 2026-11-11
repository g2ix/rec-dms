"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { FlowView } from "@/components/workflow/flow-view";
import { ROLE_KEYS, ROLE_KEY_LABEL } from "@/lib/forms/roles";
import { DURATION_UNITS, STEP_TYPES, type AssigneeRule, type Step, type WorkflowGraph } from "@/lib/workflow/graph";
import { simulateGraph, waitingForChoice } from "@/lib/workflow/simulate";
import { ChainEditor, StepAdvanced } from "@/components/workflow/step-advanced";
import { structuralIssues } from "@/lib/workflow/validate";
import { publishVersionAction, saveDraftAction } from "@/server/workflow/actions";

export function WorkflowEditor({
  versionId,
  draft,
  initial,
  publishedCodes,
  holidays,
}: {
  versionId: string;
  draft: boolean;
  initial: WorkflowGraph;
  publishedCodes: string[];
  holidays: string[];
}) {
  const router = useRouter();
  const [graph, setGraph] = useState(initial);
  const [selected, setSelected] = useState(initial.startStep);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "publish" | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [simReviewType, setSimReviewType] = useState("");
  const [simRound, setSimRound] = useState("1");

  function commit(next: WorkflowGraph) {
    setGraph(next);
    setIssues([]);
  }
  const [choices, setChoices] = useState<{ stepKey: string; outcome?: string | null }[]>([]);
  const step = graph.steps.find((item) => item.key === selected) ?? null;
  const errorKeys = new Set(
    structuralIssues(graph, new Set(publishedCodes))
      .map((issue) => issue.stepKey)
      .filter((key): key is string => Boolean(key)),
  );

  function updateStep(next: Step) {
    commit({ ...graph, steps: graph.steps.map((item) => (item.key === next.key ? next : item)) });
  }

  function save() {
    setAction("save");
    startTransition(async () => {
      const result = await saveDraftAction(versionId, graph);
      setNotice(result.ok ? "Draft saved." : result.message);
      setAction(null);
      if (result.ok) router.refresh();
    });
  }

  function publish() {
    setAction("publish");
    startTransition(async () => {
      const result = await saveDraftAction(versionId, graph);
      if (!result.ok) {
        setNotice(result.message);
        setAction(null);
        return;
      }
      await publishVersionAction(versionId, effectiveFrom || null);
    });
  }

  function validate() {
    const found = structuralIssues(graph, new Set(publishedCodes));
    setIssues(found.map((issue) => issue.message));
    setNotice(found.length === 0 ? "This graph is valid." : null);
  }

  const simulation = simulateGraph(graph, choices, new Set(holidays), new Date(), {
    reviewType: simReviewType || null,
    round: Number(simRound) || 1,
  });
  const waiting = simulation.stops.at(-1);
  const waitingStep = waitingForChoice(graph, waiting);

  return (
    <div className="rec-stack">
      {notice ? <p className="body-sm">{notice}</p> : null}
      {issues.length > 0 ? (
        <ul className="rec-methods">
          {issues.map((issue) => (
            <li key={issue}>
              <p className="body-sm" role="alert">
                {issue}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-6)", alignItems: "flex-start" }}>
        <div className="rec-stack" style={{ flex: "1 1 22rem" }}>
          <ol className="rec-methods">
            {graph.steps.map((item, index) => (
              <li key={item.key}>
                <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setSelected(item.key)} aria-current={item.key === selected ? "true" : undefined}>
                  <span>
                    {item.name} · {item.type}
                  </span>
                </button>
                {draft ? (
                  <span className="rec-actions">
                    <button type="button" className="rec-btn rec-btn--ghost" onClick={() => move(index, -1)} disabled={index === 0}>
                      <span>Up</span>
                    </button>
                    <button type="button" className="rec-btn rec-btn--ghost" onClick={() => move(index, 1)} disabled={index === graph.steps.length - 1}>
                      <span>Down</span>
                    </button>
                    <button type="button" className="rec-btn rec-btn--ghost" onClick={() => removeStep(item.key)}>
                      <span>Delete</span>
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {draft ? (
            <button type="button" className="rec-btn rec-btn--secondary" onClick={addStep}>
              <span>Add step</span>
            </button>
          ) : null}
          {step && draft ? <StepForm step={step} steps={graph.steps} onChange={updateStep} /> : null}
          {step && !draft ? (
            <p className="body-sm rec-muted">
              {step.name} is on version that is not a draft. Start a new draft to change it.
            </p>
          ) : null}
        </div>
        <div style={{ flex: "1 1 22rem" }}>
          <FlowView graph={graph} selected={selected} errors={errorKeys} onSelect={setSelected} />
        </div>
      </div>
      <section className="rec-stack">
        <h2 className="heading">Transitions</h2>
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Priority</th>
                <th scope="col">Condition</th>
                <th scope="col">Label</th>
                <th scope="col">Notice</th>
              </tr>
            </thead>
            <tbody>
              {graph.transitions.map((transition, index) => (
                <tr key={`${transition.from}-${transition.to}-${index}`}>
                  <td>
                    <StepSelect value={transition.from} steps={graph.steps} disabled={!draft} onChange={(from) => editTransition(index, { ...transition, from })} />
                  </td>
                  <td>
                    <StepSelect value={transition.to} steps={graph.steps} disabled={!draft} onChange={(to) => editTransition(index, { ...transition, to })} />
                  </td>
                  <td>
                    <input className="rec-input" inputMode="numeric" disabled={!draft} value={transition.priority ?? ""} onChange={(event) => editTransition(index, { ...transition, priority: event.target.value ? Number(event.target.value) : undefined })} />
                  </td>
                  <td>
                    <input className="rec-input" disabled={!draft} aria-label="Condition" value={transition.when ? JSON.stringify(transition.when) : ""} onChange={(event) => editTransition(index, { ...transition, when: parseWhen(event.target.value) })} />
                  </td>
                  <td>
                    <input className="rec-input" disabled={!draft} value={transition.label ?? ""} onChange={(event) => editTransition(index, { ...transition, label: event.target.value })} />
                  </td>
                  <td>
                    <input className="rec-input" disabled={!draft} aria-label="Notice template" value={transition.notify ?? ""} onChange={(event) => editTransition(index, { ...transition, notify: event.target.value || undefined })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {draft ? (
          <button type="button" className="rec-btn rec-btn--secondary" onClick={() => commit({ ...graph, transitions: [...graph.transitions, { from: graph.startStep, to: graph.steps[0]?.key ?? graph.startStep }] })}>
            <span>Add transition</span>
          </button>
        ) : null}
      </section>
      <section className="rec-stack">
        <h2 className="heading">Simulate</h2>
        <div className="rec-actions">
          <label className="rec-field">
            <span className="label">Review type at the start</span>
            <select className="rec-select" value={simReviewType} onChange={(event) => setSimReviewType(event.target.value)}>
              <option value="">Not set</option>
              <option value="EXEMPT">Exempt</option>
              <option value="EXPEDITED">Expedited</option>
              <option value="FULL">Full</option>
            </select>
          </label>
          <label className="rec-field">
            <span className="label">Review round</span>
            <input className="rec-input" inputMode="numeric" value={simRound} onChange={(event) => setSimRound(event.target.value)} />
          </label>
        </div>
        <ol className="rec-methods">
          {simulation.stops.map((stop, index) => (
            <li key={`${stop.stepKey}-${index}`}>
              <p className="body-sm">
                {stop.name}
                {stop.outcome ? ` · ${stop.outcome}` : ""}
                {stop.dueAt ? ` · due ${new Date(stop.dueAt).toISOString()}` : ""}
              </p>
              {stop.notes.length > 0 ? (
                <ul>
                  {stop.notes.map((note) => (
                    <li key={note} className="body-sm rec-muted">
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
        {simulation.error ? <p className="body-sm">{simulation.error}</p> : null}
        {waitingStep ? (
          <div className="rec-actions">
            {(waitingStep.outcomes ?? []).map((outcome) => (
              <button key={outcome.key} type="button" className="rec-btn rec-btn--secondary" onClick={() => setChoices([...choices, { stepKey: waitingStep.key, outcome: outcome.key }])}>
                <span>{outcome.label}</span>
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setChoices([])}>
          <span>Reset simulation</span>
        </button>
      </section>
      {draft ? (
        <div className="rec-actions">
          <BusyButton type="button" variant="secondary" busy={action === "save"} disabled={pending} busyLabel="Saving…" onClick={save}>
            Save draft
          </BusyButton>
          <button type="button" className="rec-btn rec-btn--secondary" onClick={validate} disabled={pending}>
            <span>Validate</span>
          </button>
          <label className="rec-field">
            <span className="label">Starts for new protocols on (optional)</span>
            <input className="rec-input" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </label>
          <BusyButton type="button" variant="primary" busy={action === "publish"} disabled={pending} busyLabel="Publishing…" onClick={publish}>
            {effectiveFrom ? "Publish, scheduled" : "Publish"}
          </BusyButton>
        </div>
      ) : null}
    </div>
  );

  function move(index: number, delta: number) {
    const next = graph.steps.slice();
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(index + delta, 0, item);
    commit({ ...graph, steps: next });
  }

  function removeStep(key: string) {
    commit({
      ...graph,
      startStep: graph.startStep === key ? (graph.steps.find((item) => item.key !== key)?.key ?? key) : graph.startStep,
      steps: graph.steps.filter((item) => item.key !== key),
      transitions: graph.transitions.filter((transition) => transition.from !== key && transition.to !== key),
    });
  }

  function addStep() {
    const key = `step_${graph.steps.length + 1}`;
    const created: Step = { key, name: "New step", type: "TASK", assignee: { kind: "PROTOCOL_LEADER" } };
    commit({ ...graph, steps: [...graph.steps, created] });
    setSelected(key);
  }

  function editTransition(index: number, next: WorkflowGraph["transitions"][number]) {
    commit({ ...graph, transitions: graph.transitions.map((item, itemIndex) => (itemIndex === index ? next : item)) });
  }
}

function parseWhen(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function StepSelect({
  value,
  steps,
  disabled,
  onChange,
}: {
  value: string;
  steps: Step[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select className="rec-select" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
      {steps.map((step) => (
        <option key={step.key} value={step.key}>
          {step.name}
        </option>
      ))}
    </select>
  );
}

function StepForm({ step, steps, onChange }: { step: Step; steps: Step[]; onChange: (step: Step) => void }) {
  const assignee = step.assignee;
  return (
    <div className="rec-card rec-stack">
      <h2 className="heading">{step.name}</h2>
      <label className="rec-field">
        <span className="label">Name</span>
        <input className="rec-input" value={step.name} onChange={(event) => onChange({ ...step, name: event.target.value })} />
      </label>
      <label className="rec-field">
        <span className="label">Type</span>
        <select className="rec-select" value={step.type} onChange={(event) => onChange({ ...step, type: event.target.value as Step["type"] })}>
          {STEP_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label className="rec-field">
        <span className="label">Status while this step is open</span>
        <input className="rec-input" value={step.statusLabel ?? ""} onChange={(event) => onChange({ ...step, statusLabel: event.target.value || undefined })} />
      </label>
      <label className="rec-field">
        <span className="label">Assignee</span>
        <select className="rec-select" value={assignee?.kind ?? ""} onChange={(event) => onChange({ ...step, assignee: assigneeFor(event.target.value) })}>
          <option value="">None</option>
          <option value="ROLE">Role</option>
          <option value="PANEL_ROLE_OF_PROTOCOL">Panel role of the protocol</option>
          <option value="PROTOCOL_LEADER">Project leader</option>
          <option value="PROTOCOL_PROPONENTS">Proponents</option>
          <option value="PROTOCOL_ADVISER">Adviser</option>
          <option value="ASSIGNED_IN_STEP">Reviewers assigned earlier</option>
          <option value="USER">A specific person</option>
          <option value="FIRST_AVAILABLE">First available (fallback order)</option>
        </select>
      </label>
      {assignee?.kind === "FIRST_AVAILABLE" ? (
        <ChainEditor rules={assignee.rules} onChange={(rules) => onChange({ ...step, assignee: { kind: "FIRST_AVAILABLE", rules } })} />
      ) : null}
      {assignee?.kind === "ROLE" || assignee?.kind === "PANEL_ROLE_OF_PROTOCOL" ? (
        <label className="rec-field">
          <span className="label">Role</span>
          <select className="rec-select" value={assignee.role} onChange={(event) => onChange({ ...step, assignee: { ...assignee, role: event.target.value as (typeof ROLE_KEYS)[number] } })}>
            {ROLE_KEYS.map((role) => (
              <option key={role} value={role}>
                {ROLE_KEY_LABEL[role]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {assignee?.kind === "ASSIGNED_IN_STEP" ? (
        <label className="rec-field">
          <span className="label">Assigned in</span>
          <StepSelect value={assignee.stepKey} steps={steps} disabled={false} onChange={(stepKey) => onChange({ ...step, assignee: { ...assignee, stepKey } })} />
        </label>
      ) : null}
      {assignee?.kind === "USER" ? (
        <label className="rec-field">
          <span className="label">User id</span>
          <input className="rec-input" value={assignee.userId} onChange={(event) => onChange({ ...step, assignee: { kind: "USER", userId: event.target.value } })} />
        </label>
      ) : null}
      <div className="rec-actions">
        <label className="rec-field">
          <span className="label">Deadline</span>
          <input className="rec-input" inputMode="numeric" value={step.deadline?.amount ?? ""} onChange={(event) => onChange({ ...step, deadline: event.target.value ? { ...step.deadline, amount: Number(event.target.value), unit: step.deadline?.unit ?? "WORKING_DAYS" } : undefined })} />
        </label>
        <label className="rec-field">
          <span className="label">Unit</span>
          <select className="rec-select" value={step.deadline?.unit ?? "WORKING_DAYS"} onChange={(event) => onChange({ ...step, deadline: { ...step.deadline, amount: step.deadline?.amount ?? 1, unit: event.target.value as "HOURS" | "CALENDAR_DAYS" | "WORKING_DAYS" } })}>
            {DURATION_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
      </div>
      {step.type !== "END" && step.type !== "AUTO" ? (
        <label className="rec-field rec-field--wide">
          <span className="label">Outcomes</span>
          <textarea
            className="rec-input"
            rows={3}
            value={(step.outcomes ?? []).map((outcome) => `${outcome.key}|${outcome.label}${outcome.requiresComment ? "|reason" : ""}`).join("\n")}
            onChange={(event) => onChange({ ...step, outcomes: parseOutcomes(event.target.value) })}
          />
          <span className="rec-field__help">One outcome per line, as KEY|Label. Add |reason when the comment is required for that outcome.</span>
        </label>
      ) : null}
      {step.type === "PARALLEL_TASK" ? (
        <label className="rec-field">
          <span className="label">Complete when</span>
          <select
            className="rec-select"
            value={typeof step.parallel?.completeWhen === "object" ? "AT_LEAST" : (step.parallel?.completeWhen ?? "ALL")}
            onChange={(event) =>
              onChange({
                ...step,
                parallel: {
                  completeWhen: event.target.value === "AT_LEAST" ? { atLeast: 1 } : event.target.value === "ANY" ? "ANY" : "ALL",
                },
              })
            }
          >
            <option value="ALL">All</option>
            <option value="ANY">Any</option>
            <option value="AT_LEAST">At least</option>
          </select>
        </label>
      ) : null}
      <label className="rec-field rec-field--wide">
        <span className="label">Forms</span>
        <textarea
          className="rec-input"
          rows={3}
          value={(step.forms ?? [])
            .map((form) => [form.code, form.mode, form.required ? "required" : "optional", form.perAssignee ? "each" : "", form.slot ? `slot:${form.slot}` : ""].filter(Boolean).join("|"))
            .join("\n")}
          onChange={(event) => onChange({ ...step, forms: parseForms(event.target.value) })}
        />
        <span className="rec-field__help">One form per line, as CODE|FILL|required. Mode is FILL, SIGN, or VIEW. Add |each for one copy per assignee, or |slot:KEY to limit it to one reviewer slot.</span>
      </label>
      <StepAdvanced step={step} onChange={onChange} />
      <label className="rec-field">
        <span className="label">Notify when assigned</span>
        <input className="rec-input" value={step.notify?.onAssigned ?? ""} onChange={(event) => onChange({ ...step, notify: { ...step.notify, onAssigned: event.target.value || undefined } })} />
      </label>
      <label className="rec-field">
        <span className="label">Notify when due soon</span>
        <input className="rec-input" value={step.notify?.onDueSoon ?? ""} onChange={(event) => onChange({ ...step, notify: { ...step.notify, onDueSoon: event.target.value || undefined } })} />
      </label>
      <label className="rec-field">
        <span className="label">Notify when overdue</span>
        <input className="rec-input" value={step.notify?.onOverdue ?? ""} onChange={(event) => onChange({ ...step, notify: { ...step.notify, onOverdue: event.target.value || undefined } })} />
      </label>
      <label className="rec-field">
        <span className="label">Notify when completed</span>
        <input className="rec-input" value={step.notify?.onCompleted ?? ""} onChange={(event) => onChange({ ...step, notify: { ...step.notify, onCompleted: event.target.value || undefined } })} />
      </label>
    </div>
  );
}

function assigneeFor(kind: string): AssigneeRule | undefined {
  if (kind === "ROLE") return { kind: "ROLE", role: "REC_STAFF" };
  if (kind === "PANEL_ROLE_OF_PROTOCOL") return { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" };
  if (kind === "PROTOCOL_LEADER") return { kind: "PROTOCOL_LEADER" };
  if (kind === "PROTOCOL_PROPONENTS") return { kind: "PROTOCOL_PROPONENTS" };
  if (kind === "PROTOCOL_ADVISER") return { kind: "PROTOCOL_ADVISER" };
  if (kind === "ASSIGNED_IN_STEP") return { kind: "ASSIGNED_IN_STEP", stepKey: "start" };
  if (kind === "USER") return { kind: "USER", userId: "00000000-0000-4000-8000-000000000000" };
  if (kind === "FIRST_AVAILABLE") return { kind: "FIRST_AVAILABLE", rules: [{ kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" }] };
  return undefined;
}

function parseOutcomes(value: string): Step["outcomes"] {
  const rows = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, flag] = line.split("|");
      const row: NonNullable<Step["outcomes"]>[number] = { key: (key ?? "").trim(), label: (label ?? key ?? "").trim() };
      if (flag?.trim() === "reason") row.requiresComment = true;
      return row;
    })
    .filter((row) => row.key && row.label);
  return rows.length > 0 ? rows : undefined;
}

function parseForms(value: string): Step["forms"] {
  const rows = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [code, mode, required, ...rest] = line.split("|");
      const parsedMode = mode?.trim() === "SIGN" || mode?.trim() === "VIEW" ? mode.trim() : "FILL";
      const row: NonNullable<Step["forms"]>[number] = {
        code: (code ?? "").trim(),
        mode: parsedMode as "FILL" | "SIGN" | "VIEW",
        required: (required ?? "required").trim() !== "optional",
      };
      for (const part of rest.map((item) => item.trim())) {
        if (part === "each") row.perAssignee = true;
        else if (part.startsWith("slot:") && part.length > 5) row.slot = part.slice(5);
      }
      return row;
    })
    .filter((row) => row.code);
  return rows.length > 0 ? rows : undefined;
}
