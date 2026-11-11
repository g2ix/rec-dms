"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { FEE_BASES, type FeeBasisKey } from "@/lib/fees/calc";
import { centavosFromPesos, formatCentavos, pesosInput } from "@/lib/forms/money";
import { previewFeeAction, saveClientTypeAction, saveScheduleAction } from "@/server/fees/actions";

type ClientTypeRow = { key: string; label: string; active: boolean; sortOrder: number };
export type ScheduleRow = {
  id: string;
  effectiveFrom: string;
  approvedRef: string;
  notes: string;
  bills: number;
  rates: { clientTypeKey: string; basis: FeeBasisKey; amount: number }[];
  rules: { key: string; label: string; percent: number; fromRound: number | null }[];
};

const BASIS_LABEL: Record<FeeBasisKey, string> = { EXPEDITED: "Expedited", FULL: "Full", EXEMPT: "Exempt" };

export function ClientTypeForm() {
  const [state, action, pending] = useActionState(saveClientTypeAction, null);
  return (
    <form action={action} className="rec-actions">
      {state?.error ? (
        <p className="rec-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      <label className="rec-field">
        <span className="label">Key</span>
        <input className="rec-input" name="key" required />
      </label>
      <label className="rec-field">
        <span className="label">Label</span>
        <input className="rec-input" name="label" required />
      </label>
      <label className="rec-field">
        <span className="label">Order</span>
        <input className="rec-input" name="sortOrder" inputMode="numeric" defaultValue="0" />
      </label>
      <label className="rec-choice">
        <input type="checkbox" name="active" defaultChecked />
        <span>Active</span>
      </label>
      <BusyButton type="submit" busy={pending} busyLabel="Saving…">
        Save client type
      </BusyButton>
    </form>
  );
}

/** Grid of client type × basis, the rules, the effective date. A schedule that priced a bill is read-only. */
export function ScheduleEditor({ types, schedule }: { types: ClientTypeRow[]; schedule: ScheduleRow | null }) {
  const router = useRouter();
  const locked = Boolean(schedule && schedule.bills > 0);
  const [effectiveFrom, setEffectiveFrom] = useState(schedule?.effectiveFrom ?? "");
  const [approvedRef, setApprovedRef] = useState(schedule?.approvedRef ?? "");
  const [notes, setNotes] = useState(schedule?.notes ?? "");
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const rate of schedule?.rates ?? []) out[`${rate.clientTypeKey}:${rate.basis}`] = pesosInput(rate.amount);
    return out;
  });
  const [rules, setRules] = useState(schedule?.rules.map((rule) => ({ ...rule, percentText: String(rule.percent), fromText: rule.fromRound == null ? "" : String(rule.fromRound) })) ?? []);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMessage(null);
    const rates = [];
    for (const type of types) {
      for (const basis of FEE_BASES) {
        const text = amounts[`${type.key}:${basis}`] ?? "";
        if (!text.trim()) continue;
        const amount = centavosFromPesos(text);
        if (amount == null || Number.isNaN(amount) || amount < 0) {
          setBusy(false);
          setMessage(`Check the amount for ${type.label}, ${BASIS_LABEL[basis]}.`);
          return;
        }
        rates.push({ clientTypeKey: type.key, basis, amount });
      }
    }
    const result = await saveScheduleAction({
      id: schedule?.id ?? null,
      effectiveFrom,
      approvedRef,
      notes,
      rates,
      rules: rules.map((rule) => ({ key: rule.key, label: rule.label, percent: Number(rule.percentText), fromRound: rule.fromText ? Number(rule.fromText) : null })),
    });
    setBusy(false);
    setMessage(result.ok ? "Schedule saved." : result.message);
    if (result.ok) router.refresh();
  }

  return (
    <div className="rec-stack">
      {locked ? <p className="body-sm rec-muted">Bills were issued under this schedule, so it cannot change. Add a new schedule with a later date.</p> : null}
      <div className="rec-actions">
        <label className="rec-field">
          <span className="label">Takes effect</span>
          <input className="rec-input" type="date" value={effectiveFrom} disabled={locked} onChange={(event) => setEffectiveFrom(event.target.value)} />
        </label>
        <label className="rec-field">
          <span className="label">Approved by (memo or reference)</span>
          <input className="rec-input" value={approvedRef} disabled={locked} onChange={(event) => setApprovedRef(event.target.value)} />
        </label>
        <label className="rec-field rec-field--wide">
          <span className="label">Notes</span>
          <input className="rec-input" value={notes} disabled={locked} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">Client type</th>
              {FEE_BASES.map((basis) => (
                <th scope="col" key={basis}>
                  {BASIS_LABEL[basis]} (₱)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr key={type.key}>
                <th scope="row">{type.label}</th>
                {FEE_BASES.map((basis) => (
                  <td key={basis}>
                    <input
                      className="rec-input"
                      inputMode="decimal"
                      aria-label={`${type.label}, ${BASIS_LABEL[basis]}`}
                      disabled={locked}
                      value={amounts[`${type.key}:${basis}`] ?? ""}
                      onChange={(event) => setAmounts({ ...amounts, [`${type.key}:${basis}`]: event.target.value })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="subheading">Rules</h3>
      <p className="body-sm rec-muted">A rule charges a percent of the base rate. NTH_REVIEW applies from the round you give (for example 3 for the 3rd review). Other keys, such as AMENDMENT or CONTINUING, are named by a workflow step.</p>
      {rules.map((rule, index) => (
        <div className="rec-actions" key={index}>
          <label className="rec-field">
            <span className="label">Key</span>
            <input className="rec-input" value={rule.key} disabled={locked} onChange={(event) => setRules(rules.map((item, at) => (at === index ? { ...item, key: event.target.value } : item)))} />
          </label>
          <label className="rec-field">
            <span className="label">Label</span>
            <input className="rec-input" value={rule.label} disabled={locked} onChange={(event) => setRules(rules.map((item, at) => (at === index ? { ...item, label: event.target.value } : item)))} />
          </label>
          <label className="rec-field">
            <span className="label">Percent of base</span>
            <input className="rec-input" inputMode="numeric" value={rule.percentText} disabled={locked} onChange={(event) => setRules(rules.map((item, at) => (at === index ? { ...item, percentText: event.target.value } : item)))} />
          </label>
          <label className="rec-field">
            <span className="label">From round</span>
            <input className="rec-input" inputMode="numeric" value={rule.fromText} disabled={locked} onChange={(event) => setRules(rules.map((item, at) => (at === index ? { ...item, fromText: event.target.value } : item)))} />
          </label>
          {!locked ? (
            <button type="button" className="rec-btn rec-btn--ghost" onClick={() => setRules(rules.filter((_, at) => at !== index))}>
              <span>Remove</span>
            </button>
          ) : null}
        </div>
      ))}
      {!locked ? (
        <div className="rec-actions">
          <button type="button" className="rec-btn rec-btn--secondary" onClick={() => setRules([...rules, { key: "", label: "", percent: 0, fromRound: null, percentText: "", fromText: "" }])}>
            <span>Add rule</span>
          </button>
          <BusyButton type="button" variant="primary" busy={busy} busyLabel="Saving…" onClick={save}>
            {schedule ? "Save schedule" : "Add schedule"}
          </BusyButton>
        </div>
      ) : null}
      {message ? (
        <p className="body-sm" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function FeeCalculator({ types }: { types: ClientTypeRow[] }) {
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [clientTypeKey, setClientTypeKey] = useState(types[0]?.key ?? "");
  const [reviewType, setReviewType] = useState<FeeBasisKey>("EXPEDITED");
  const [basis, setBasis] = useState("reviewType");
  const [round, setRound] = useState("1");
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    const answer = await previewFeeAction({ day, clientTypeKey, reviewType, basis, round: Number(round) || 1 });
    if (!answer.ok) setResult(answer.message);
    else if (answer.amount == null) setResult(`${answer.note}${answer.scheduleFrom ? ` (schedule from ${answer.scheduleFrom})` : ""}`);
    else setResult(`${answer.amount === 0 ? "Waived" : formatCentavos(answer.amount)} · ${answer.note} · schedule from ${answer.scheduleFrom}`);
  }

  return (
    <div className="rec-stack">
      <div className="rec-actions">
        <label className="rec-field">
          <span className="label">Issue date</span>
          <input className="rec-input" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        <label className="rec-field">
          <span className="label">Client type</span>
          <select className="rec-select" value={clientTypeKey} onChange={(event) => setClientTypeKey(event.target.value)}>
            {types.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label className="rec-field">
          <span className="label">Review type</span>
          <select className="rec-select" value={reviewType} onChange={(event) => setReviewType(event.target.value as FeeBasisKey)}>
            {FEE_BASES.map((item) => (
              <option key={item} value={item}>
                {BASIS_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="rec-field">
          <span className="label">Basis</span>
          <select className="rec-select" value={basis} onChange={(event) => setBasis(event.target.value)}>
            <option value="reviewType">Review type</option>
            <option value="nthReview">Nth review</option>
            <option value="AMENDMENT">Amendment</option>
            <option value="CONTINUING">Continuing review</option>
          </select>
        </label>
        <label className="rec-field">
          <span className="label">Round</span>
          <input className="rec-input" inputMode="numeric" value={round} onChange={(event) => setRound(event.target.value)} />
        </label>
        <button type="button" className="rec-btn rec-btn--secondary" onClick={run}>
          <span>Calculate</span>
        </button>
      </div>
      {result ? (
        <p className="body" role="status">
          {result}
        </p>
      ) : null}
    </div>
  );
}
