"use client";

import { useEffect, useRef, useState } from "react";
import { ROLE_KEYS, ROLE_KEY_LABEL } from "@/lib/forms/roles";
import { assigneeRuleSchema, stepSchema, type BaseAssigneeRule, type Step } from "@/lib/workflow/graph";

type RoleKey = (typeof ROLE_KEYS)[number];

/** A JSON value edited as text. Applied when it parses; the error stays beside the box until then. */
export function JsonField<T>({
  label,
  help,
  value,
  onChange,
  check,
  rows = 4,
}: {
  label: string;
  help?: string;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  check?: (value: unknown) => string | null;
  rows?: number;
}) {
  const [text, setText] = useState(value === undefined ? "" : JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const emitted = useRef<string>(JSON.stringify(value ?? null));
  useEffect(() => {
    const incoming = JSON.stringify(value ?? null);
    if (incoming === emitted.current) return;
    emitted.current = incoming;
    setText(value === undefined ? "" : JSON.stringify(value, null, 2));
    setError(null);
  }, [value]);
  function apply(next: string) {
    setText(next);
    if (!next.trim()) {
      setError(null);
      emitted.current = "null";
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(next) as unknown;
      const problem = check?.(parsed) ?? null;
      setError(problem);
      if (!problem) {
        emitted.current = JSON.stringify(parsed);
        onChange(parsed as T);
      }
    } catch {
      setError("Not valid JSON yet.");
    }
  }
  return (
    <label className="rec-field rec-field--wide">
      <span className="label">{label}</span>
      <textarea className="rec-input code" rows={rows} value={text} onChange={(event) => apply(event.target.value)} spellCheck={false} />
      {help ? <span className="rec-field__help">{help}</span> : null}
      {error ? (
        <span className="rec-field__help" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** Checks one field of a step against the step schema, so the builder refuses what the engine would refuse. */
function fieldCheck(field: keyof Step) {
  return (value: unknown) => {
    const parsed = stepSchema.pick({ [field]: true } as Record<keyof Step, true>).safeParse({ [field]: value });
    return parsed.success ? null : (parsed.error.issues[0]?.message ?? "This value is not valid.");
  };
}

const BASE_KINDS: BaseAssigneeRule["kind"][] = ["PANEL_ROLE_OF_PROTOCOL", "ROLE", "PROTOCOL_LEADER", "PROTOCOL_ADVISER", "USER"];

function baseRule(kind: string): BaseAssigneeRule {
  if (kind === "ROLE") return { kind: "ROLE", role: "REC_STAFF" };
  if (kind === "PANEL_ROLE_OF_PROTOCOL") return { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" };
  if (kind === "PROTOCOL_ADVISER") return { kind: "PROTOCOL_ADVISER" };
  if (kind === "USER") return { kind: "USER", userId: "00000000-0000-4000-8000-000000000000" };
  return { kind: "PROTOCOL_LEADER" };
}

/** The ordered fallback list of a FIRST_AVAILABLE assignee. */
export function ChainEditor({ rules, onChange }: { rules: BaseAssigneeRule[]; onChange: (rules: BaseAssigneeRule[]) => void }) {
  return (
    <fieldset className="rec-stack">
      <legend className="label">Fallback order</legend>
      <p className="rec-field__help">The task goes to the first person available, skipping members of the protocol and anyone who declared a conflict.</p>
      {rules.map((rule, index) => (
        <div key={index} className="rec-actions">
          <span className="body-sm">{index + 1}.</span>
          <select className="rec-select" value={rule.kind} aria-label={`Rule ${index + 1}`} onChange={(event) => onChange(rules.map((item, at) => (at === index ? baseRule(event.target.value) : item)))}>
            {BASE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "PANEL_ROLE_OF_PROTOCOL" ? "Panel role" : kind === "ROLE" ? "Role" : kind === "PROTOCOL_LEADER" ? "Project leader" : kind === "PROTOCOL_ADVISER" ? "Adviser" : "A specific person"}
              </option>
            ))}
          </select>
          {rule.kind === "ROLE" || rule.kind === "PANEL_ROLE_OF_PROTOCOL" ? (
            <select
              className="rec-select"
              aria-label={`Role ${index + 1}`}
              value={rule.role}
              onChange={(event) => onChange(rules.map((item, at) => (at === index ? { ...rule, role: event.target.value as RoleKey } : item)))}
            >
              {ROLE_KEYS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_KEY_LABEL[role]}
                </option>
              ))}
            </select>
          ) : null}
          {rule.kind === "USER" ? (
            <input className="rec-input" aria-label={`User id ${index + 1}`} value={rule.userId} onChange={(event) => onChange(rules.map((item, at) => (at === index ? { kind: "USER", userId: event.target.value } : item)))} />
          ) : null}
          <button type="button" className="rec-btn rec-btn--ghost" disabled={index === 0} onClick={() => onChange(swap(rules, index, index - 1))}>
            <span>Up</span>
          </button>
          <button type="button" className="rec-btn rec-btn--ghost" disabled={rules.length === 1} onClick={() => onChange(rules.filter((_, at) => at !== index))}>
            <span>Remove</span>
          </button>
        </div>
      ))}
      <button type="button" className="rec-btn rec-btn--secondary" onClick={() => onChange([...rules, baseRule("ROLE")])}>
        <span>Add fallback</span>
      </button>
    </fieldset>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = list.slice();
  const left = next[a];
  const right = next[b];
  if (left === undefined || right === undefined) return list;
  next[a] = right;
  next[b] = left;
  return next;
}

/** Controls for the M13 step fields. Every field also has a JSON box so nothing needs code to change. */
export function StepAdvanced({ step, onChange }: { step: Step; onChange: (step: Step) => void }) {
  const outcomes = step.outcomes ?? [];
  const set = <K extends keyof Step>(key: K, value: Step[K] | undefined) => {
    const next = { ...step } as Step;
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value as Step[K];
    onChange(next);
  };
  return (
    <div className="rec-stack">
      <h3 className="subheading">Reviewers and timing</h3>
      <JsonField
        label="Assign reviewers"
        help='Either { "roles": [...], "min": 2 } or { "slots": [{ "key": "SCIENTIST", "label": "Scientist", "eligible": { "roles": ["PANEL_MEMBER"], "attributes": { "isScientist": true } }, "forms": ["F-35"] }] }.'
        value={step.assignReviewers}
        onChange={(value) => set("assignReviewers", value)}
        check={fieldCheck("assignReviewers")}
        rows={6}
      />
      <fieldset className="rec-stack">
        <legend className="label">Record on this step</legend>
        {(["meetingDate", "noteToReviewers", "reviewDueDate"] as const).map((key) => (
          <label key={key} className="rec-choice">
            <input
              type="checkbox"
              checked={Boolean(step.capture?.[key])}
              onChange={(event) => {
                const capture = { ...(step.capture ?? {}) };
                if (event.target.checked) capture[key] = true;
                else delete capture[key];
                set("capture", Object.keys(capture).length > 0 ? capture : undefined);
              }}
            />
            <span>{key === "meetingDate" ? "Meeting date" : key === "noteToReviewers" ? "Note to reviewers" : "Review due date"}</span>
          </label>
        ))}
      </fieldset>
      <label className="rec-field">
        <span className="label">When the deadline passes, record</span>
        <select className="rec-select" value={step.onTimeout?.outcome ?? ""} onChange={(event) => set("onTimeout", event.target.value ? { outcome: event.target.value } : undefined)}>
          <option value="">Nothing (send reminders only)</option>
          {outcomes.map((outcome) => (
            <option key={outcome.key} value={outcome.key}>
              {outcome.label}
            </option>
          ))}
        </select>
      </label>
      <label className="rec-field">
        <span className="label">Outcome that declines the designation</span>
        <select
          className="rec-select"
          value={step.decline?.outcome ?? ""}
          onChange={(event) =>
            set(
              "decline",
              event.target.value
                ? { outcome: event.target.value, redesignateBy: step.decline?.redesignateBy ?? { kind: "PANEL_ROLE_OF_PROTOCOL", role: "PANEL_CHAIR" }, name: step.decline?.name }
                : undefined,
            )
          }
        >
          <option value="">No decline</option>
          {outcomes.map((outcome) => (
            <option key={outcome.key} value={outcome.key}>
              {outcome.label}
            </option>
          ))}
        </select>
      </label>
      {step.decline ? (
        <JsonField
          label="Who re-designates"
          help='An assignee rule, such as { "kind": "FIRST_AVAILABLE", "rules": [...] }.'
          value={step.decline.redesignateBy}
          onChange={(value) => (value ? set("decline", { ...step.decline!, redesignateBy: value }) : undefined)}
          check={(value) => (assigneeRuleSchema.safeParse(value).success ? null : "Not a valid assignee rule.")}
        />
      ) : null}
      <h3 className="subheading">Fees and release</h3>
      <label className="rec-field">
        <span className="label">Outcomes that need the fee settled</span>
        <input
          className="rec-input"
          value={(step.feeVerifiedOutcomes ?? []).join(", ")}
          onChange={(event) => set("feeVerifiedOutcomes", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
        />
        <span className="rec-field__help">Comma-separated outcome keys.</span>
      </label>
      <label className="rec-choice">
        <input type="checkbox" checked={Boolean(step.feeOverride)} onChange={(event) => set("feeOverride", event.target.checked || undefined)} />
        <span>REC Staff may choose those outcomes with the bill open, after typing a reason</span>
      </label>
      <JsonField
        label="Release package"
        help='Per decision: { "APPROVED": { "send": ["certificate:F-40"], "keep": ["F-39"] }, "MINOR": { "send": ["F-39", { "item": "F-38", "redact": ["reviewer_name", "reviewer_signature"], "showOriginal": false }] } }.'
        value={step.release}
        onChange={(value) => set("release", value)}
        check={fieldCheck("release")}
        rows={6}
      />
      <h3 className="subheading">Actions and values</h3>
      <JsonField
        label="Actions"
        help='Such as [{ "kind": "ISSUE_BILL", "params": { "basis": "reviewType" } }, { "kind": "REOPEN_VERSION", "params": { "forms": ["F-41"] } }].'
        value={step.actions}
        onChange={(value) => set("actions", value)}
        check={fieldCheck("actions")}
        rows={5}
      />
      <JsonField
        label="Set protocol fields"
        help='Such as [{ "path": "protocol.reviewType", "from": "value", "value": "FULL", "when": { "==": [{ "var": "outcome" }, "DISAPPROVED"] } }].'
        value={step.setFields}
        onChange={(value) => set("setFields", value)}
        check={fieldCheck("setFields")}
      />
      <JsonField label="Side tasks" value={step.sideTasks} onChange={(value) => set("sideTasks", value)} check={fieldCheck("sideTasks")} />
      <details>
        <summary className="label">Whole step as JSON</summary>
        <JsonField
          label="Step"
          value={step}
          onChange={(value) => (value ? onChange(value) : undefined)}
          check={(value) => {
            const parsed = stepSchema.safeParse(value);
            if (!parsed.success) return parsed.error.issues[0]?.message ?? "Not a valid step.";
            return (value as Step).key === step.key ? null : "Keep the step key; rename steps from the list.";
          }}
          rows={16}
        />
      </details>
    </div>
  );
}
