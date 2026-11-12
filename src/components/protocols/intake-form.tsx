"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Radio, RadioGroup } from "@/components/ui/radio";
import { Textarea } from "@/components/ui/textarea";
import { useAutosaveLifecycle } from "@/hooks/use-autosave-lifecycle";
import { createAutosaveQueue, keepaliveSavePayload, postKeepalive, type AutosaveQueue, type AutosaveUi } from "@/lib/forms/autosave";
import { formatConflict } from "@/lib/forms/conflict";
import { centavosFromPesos, formatCentavos, pesosInput } from "@/lib/forms/money";
import {
  BUDGET_ITEM_GUIDE,
  BUDGET_SECTION_LABELS,
  BUDGET_SECTIONS,
  SCOPING_KEYS,
  SCOPING_QUESTIONS,
  budgetColumnsFor,
  lineTotal,
  type BudgetColumn,
  type BudgetLine,
  type IntakeGap,
  type IntakeSection,
  type IntakeValues,
} from "@/lib/intake/model";
import { naLabel } from "@/lib/intake/scoping";
import { saveIntakeAction, setAgreementAction } from "@/server/intake/actions";
import type { PointGroup } from "@/server/intake/state";

const COLUMN_LABEL: Record<BudgetColumn, string> = { personal: "Personal", external: "External Source", internal: "Internal Source" };

const SECTION_VALUE: Record<IntakeSection, (values: IntakeValues) => unknown> = {
  scoping: (values) => values.scoping,
  coi: (values) => values.coi,
  budget: (values) => values.budgetLines,
  references: (values) => values.references,
  actions: (values) => values.actions,
};

type Researcher = { memberId: string; name: string; declarationsAt: string | null; consentsAt: string | null };

export function IntakeForm({
  protocolId,
  editable,
  initialRevision,
  initialValues,
  groups,
  actionPoints,
  fundingCodes,
  gaps,
  feeEstimate,
  mine,
  researchers,
  wording,
}: {
  protocolId: string;
  editable: boolean;
  initialRevision: number;
  initialValues: IntakeValues;
  groups: PointGroup[];
  actionPoints: { code: string; label: string; comments: string }[];
  fundingCodes: string[];
  gaps: IntakeGap[];
  feeEstimate: number | null;
  mine: { memberId: string | null; declarationsAt: string | null; consentsAt: string | null };
  researchers: Researcher[];
  wording: { declarations: string[]; coi: { NONE: string; SPECIFY: string }; consents: string[] };
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [ui, setUi] = useState<Partial<Record<IntakeSection, AutosaveUi>>>({});
  const revision = useRef(initialRevision);

  const queue = useMemo<AutosaveQueue | null>(() => {
    if (!editable) return null;
    return createAutosaveQueue({
      getRevision: () => revision.current,
      save: async ({ path, value, expectedRevision }) => saveIntakeAction({ protocolId, section: path, value, expectedRevision }),
      keepaliveSave: ({ fields, expectedRevision }) => postKeepalive(`/api/protocols/${protocolId}/intake`, keepaliveSavePayload({ fields, expectedRevision })),
      hooks: {
        onUi: (path, next) => setUi((current) => ({ ...current, [path]: next })),
        onRevision: (next) => {
          revision.current = next;
        },
        onSignaturesVoided: () => router.refresh(),
      },
    });
  }, [editable, protocolId, router]);
  useEffect(() => () => queue?.dispose(), [queue]);
  useAutosaveLifecycle(queue, editable);

  function change(section: IntakeSection, next: IntakeValues) {
    setValues(next);
    queue?.schedule(section, SECTION_VALUE[section](next));
  }

  function takeTheirs(section: IntakeSection) {
    const conflict = ui[section]?.conflict;
    if (!conflict || !queue) return;
    queue.unblock(section);
    queue.dropPending(section);
    const theirs = conflict.value;
    setValues((current) => {
      if (section === "budget") return { ...current, budgetLines: Array.isArray(theirs) ? (theirs as BudgetLine[]) : [] };
      const key = section === "scoping" ? "scoping" : section === "coi" ? "coi" : section === "references" ? "references" : "actions";
      return { ...current, [key]: theirs && typeof theirs === "object" ? theirs : {} };
    });
    setUi((current) => ({ ...current, [section]: { state: "saved" } }));
  }

  function keepMine(section: IntakeSection) {
    if (!queue) return;
    queue.unblock(section);
    queue.schedule(section, SECTION_VALUE[section](values));
  }

  const status = (section: IntakeSection) => (
    <SaveStatus ui={ui[section]} onUseTheirs={() => takeTheirs(section)} onKeepMine={() => keepMine(section)} />
  );
  const gapsOf = (section: IntakeGap["section"]) => gaps.filter((gap) => gap.section === section);
  const open = budgetColumnsFor(fundingCodes);

  return (
    <div className="rec-stack">
      <section className="rec-card rec-stack">
        <h2 className="heading">Intake</h2>
        <p className="body">
          Answer once for this version. F-27, F-28, F-30 and your columns of F-35, F-36 and F-38 are printed from these answers and from{" "}
          <Link href={`/app/protocols/${protocolId}/details`}>Details</Link>, which is the Study section of the intake. You do not fill those forms one by one.
        </p>
        {!editable ? <p className="body-sm rec-muted">This version is submitted, or you are not a proponent on it. The answers are shown read-only.</p> : null}
        <Gaps gaps={gapsOf("study")} />
      </section>

      <section id="scoping" className="rec-card rec-stack" aria-labelledby="intake-scoping">
        <h2 id="intake-scoping" className="heading">
          Scoping questions
        </h2>
        <p className="body-sm rec-muted">A no marks the points of F-35 and F-36 that only apply otherwise as N/A, with your answer as the reason. Reviewers still see them.</p>
        {SCOPING_KEYS.map((key) => (
          <RadioGroup key={key} label={SCOPING_QUESTIONS[key]}>
            {(["yes", "no"] as const).map((choice) => (
              <Radio
                key={choice}
                name={`scoping-${key}`}
                label={choice === "yes" ? "Yes" : "No"}
                checked={values.scoping[key] === (choice === "yes")}
                disabled={!editable}
                onChange={() => change("scoping", { ...values, scoping: { ...values.scoping, [key]: choice === "yes" } })}
              />
            ))}
          </RadioGroup>
        ))}
        {values.scoping.consentNeeded === false ? (
          <div className="rec-field">
            <label className="rec-field__label" htmlFor="waiver-reason">
              Why is informed consent not needed?
            </label>
            <p className="rec-field__help">Name the exemption you invoke (for example, the NEGRIHP 2022 waiver criteria) and why it applies.</p>
            <Textarea
              id="waiver-reason"
              value={values.scoping.waiverReason ?? ""}
              disabled={!editable}
              onChange={(event) => change("scoping", { ...values, scoping: { ...values.scoping, waiverReason: event.target.value } })}
            />
          </div>
        ) : null}
        {status("scoping")}
        <Gaps gaps={gapsOf("scoping")} />
      </section>

      <section id="coi" className="rec-card rec-stack" aria-labelledby="intake-coi">
        <h2 id="intake-coi" className="heading">
          Conflict of Interest (COI)
        </h2>
        <RadioGroup label="Please tick the appropriate item">
          {(["NONE", "SPECIFY"] as const).map((kind) => (
            <Radio
              key={kind}
              name="coi-kind"
              label={wording.coi[kind]}
              checked={values.coi.kind === kind}
              disabled={!editable}
              onChange={() => change("coi", { ...values, coi: { ...values.coi, kind } })}
            />
          ))}
        </RadioGroup>
        {values.coi.kind === "SPECIFY" ? (
          <div className="rec-field">
            <label className="rec-field__label" htmlFor="coi-text">
              Specify the conflict of interest
            </label>
            <Textarea id="coi-text" value={values.coi.text ?? ""} disabled={!editable} onChange={(event) => change("coi", { ...values, coi: { ...values.coi, text: event.target.value } })} />
          </div>
        ) : null}
        {status("coi")}
        <Gaps gaps={gapsOf("coi")} />
      </section>

      <BudgetSection
        lines={values.budgetLines}
        open={open}
        editable={editable}
        feeEstimate={feeEstimate}
        onChange={(budgetLines) => change("budget", { ...values, budgetLines })}
        status={status("budget")}
        gaps={gapsOf("budget")}
        detailsHref={`/app/protocols/${protocolId}/details`}
      />

      {groups.length > 0 ? (
        <section id="references" className="rec-card rec-stack" aria-labelledby="intake-references">
          <h2 id="intake-references" className="heading">
            Page & Line No. where each assessment point can be found
          </h2>
          <p className="body-sm rec-muted">
            Point into your uploaded proposal (F-35) and Informed Consent Form (F-36). Tick NA when a point does not apply. Points your scoping answers mark N/A are left out.
          </p>
          {groups.map((group) => (
            <ReferenceGroup
              key={group.form}
              group={group}
              references={values.references}
              editable={editable}
              onChange={(references) => change("references", { ...values, references })}
            />
          ))}
          {status("references")}
          <Gaps gaps={gapsOf("references")} />
        </section>
      ) : null}

      {actionPoints.length > 0 ? (
        <section id="actions" className="rec-card rec-stack" aria-labelledby="intake-actions">
          <h2 id="intake-actions" className="heading">
            Actions taken (F-38)
          </h2>
          <p className="body-sm rec-muted">For each point the panel flagged, say what you changed and where (page and paragraph number).</p>
          {actionPoints.map((point) => (
            <div key={point.code} className="rec-field">
              <label className="rec-field__label" htmlFor={`action-${point.code}`}>
                <span className="code">{point.code}</span> {point.label}
              </label>
              {point.comments ? <p className="rec-field__help">Panel/Reviewers&apos; comments: {point.comments}</p> : null}
              <Textarea
                id={`action-${point.code}`}
                value={values.actions[point.code] ?? ""}
                disabled={!editable}
                onChange={(event) => change("actions", { ...values, actions: { ...values.actions, [point.code]: event.target.value } })}
              />
            </div>
          ))}
          {status("actions")}
          <Gaps gaps={gapsOf("actions")} />
        </section>
      ) : null}

      <Agreements protocolId={protocolId} editable={editable} mine={mine} researchers={researchers} wording={wording} gaps={gapsOf("agreements")} />
    </div>
  );
}

function SaveStatus({ ui, onUseTheirs, onKeepMine }: { ui: AutosaveUi | undefined; onUseTheirs: () => void; onKeepMine: () => void }) {
  if (!ui || ui.state === "idle") return ui?.error ? <p className="rec-field__error">{ui.error}</p> : null;
  if (ui.state === "conflict" && ui.conflict) {
    return (
      <div className="rec-stack">
        <p className="rec-save rec-save--conflict" role="status">
          {formatConflict(ui.conflict)}
        </p>
        <div className="rec-actions">
          <Button type="button" variant="secondary" onClick={onUseTheirs}>
            Use theirs
          </Button>
          <Button type="button" variant="primary" onClick={onKeepMine}>
            Keep mine
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p className="rec-save" data-state={ui.state} role="status">
      {ui.state === "saving" ? "Saving…" : "Saved"}
    </p>
  );
}

function Gaps({ gaps }: { gaps: IntakeGap[] }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="body-sm rec-muted">
      {gaps.map((gap) => (
        <li key={gap.message}>{gap.message}</li>
      ))}
    </ul>
  );
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `line-${Date.now()}-${Math.random()}`;
}

function BudgetSection({
  lines,
  open,
  editable,
  feeEstimate,
  onChange,
  status,
  gaps,
  detailsHref,
}: {
  lines: BudgetLine[];
  open: BudgetColumn[];
  editable: boolean;
  feeEstimate: number | null;
  onChange: (lines: BudgetLine[]) => void;
  status: React.ReactNode;
  gaps: IntakeGap[];
  detailsHref: string;
}) {
  const fee = lines.find((line) => line.fee);
  const update = (id: string, patch: Partial<BudgetLine>) => onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  const remove = (id: string) => onChange(lines.filter((line) => line.id !== id));
  const sum = (column: BudgetColumn | "total") =>
    lines.reduce((total, line) => total + (column === "total" ? lineTotal(line) : (line[column] ?? 0)), 0);
  return (
    <section id="budget" className="rec-card rec-stack" aria-labelledby="intake-budget">
      <h2 id="intake-budget" className="heading">
        Detailed budget (F-30)
      </h2>
      {open.length === 0 ? (
        <p className="body-sm">
          Choose the source of funds on <Link href={detailsHref}>Details</Link> first. Each source opens its column: researcher-funded opens Personal, an agency or other source opens External, the institution opens Internal.
        </p>
      ) : (
        <p className="body-sm rec-muted">
          Amounts in pesos. Columns open from your sources of funds: {open.map((column) => COLUMN_LABEL[column]).join(", ")}. The items under each heading are a guide; rename or add your own.
        </p>
      )}
      {BUDGET_SECTIONS.map((section) => {
        const rows = lines.filter((line) => line.section === section && !line.fee);
        return (
          <div key={section} className="rec-stack">
            <h3 className="label">{BUDGET_SECTION_LABELS[section]}</h3>
            {rows.length > 0 || (section === "MOOE" && fee) ? (
              <div className="rec-table-wrap">
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th scope="col">Particulars</th>
                      {open.map((column) => (
                        <th key={column} scope="col">
                          {COLUMN_LABEL[column]}
                        </th>
                      ))}
                      <th scope="col">Total</th>
                      {editable ? <th scope="col">Remove</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {[...rows, ...(section === "MOOE" && fee ? [fee] : [])].map((line) => (
                      <tr key={line.id}>
                        <td>
                          {line.fee ? (
                            "d. Ethics Review Fee"
                          ) : (
                            <>
                              <input
                                className="rec-input"
                                aria-label="Particulars"
                                list={`guide-${section}`}
                                value={line.item}
                                disabled={!editable}
                                onChange={(event) => update(line.id, { item: event.target.value })}
                              />
                            </>
                          )}
                        </td>
                        {open.map((column) => (
                          <td key={column}>
                            <MoneyInput label={`${COLUMN_LABEL[column]}: ${line.fee ? "Ethics Review Fee" : line.item}`} value={line[column] ?? null} disabled={!editable} onChange={(value) => update(line.id, { [column]: value })} />
                          </td>
                        ))}
                        <td>{formatCentavos(lineTotal(line))}</td>
                        {editable ? (
                          <td>
                            <Button type="button" variant="secondary" onClick={() => remove(line.id)}>
                              Remove
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <datalist id={`guide-${section}`}>
                  {BUDGET_ITEM_GUIDE[section].map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </div>
            ) : null}
            {editable && open.length > 0 ? (
              <div className="rec-actions">
                <Button type="button" variant="secondary" onClick={() => onChange([...lines, { id: newId(), section, item: BUDGET_ITEM_GUIDE[section][rows.length] ?? "" }])}>
                  Add a line
                </Button>
                {section === "MOOE" && !fee ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onChange([...lines, { id: newId(), section: "MOOE", item: "Ethics Review Fee", fee: true, [open[0]!]: feeEstimate ?? null }])}
                  >
                    Add the Ethics Review Fee
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
      {fee && feeEstimate != null ? (
        <p className="caption rec-muted">
          The fee starts from the expedited rate for your client type, {formatCentavos(feeEstimate)}. The bill issued on the type of review is what you pay.
        </p>
      ) : null}
      <p className="body">
        <strong>GRAND TOTAL:</strong> {formatCentavos(sum("total"))}
      </p>
      {status}
      <Gaps gaps={gaps} />
    </section>
  );
}

function MoneyInput({ label, value, disabled, onChange }: { label: string; value: number | null; disabled: boolean; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value == null ? "" : pesosInput(value));
  return (
    <input
      className="rec-input"
      inputMode="decimal"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => {
        setText(event.target.value);
        const trimmed = event.target.value.trim();
        if (!trimmed) return onChange(null);
        const parsed = centavosFromPesos(trimmed);
        if (parsed != null) onChange(parsed);
      }}
    />
  );
}

function ReferenceGroup({
  group,
  references,
  editable,
  onChange,
}: {
  group: PointGroup;
  references: IntakeValues["references"];
  editable: boolean;
  onChange: (references: IntakeValues["references"]) => void;
}) {
  const shown = group.points.filter((point) => point.na.length === 0);
  const hidden = group.points.filter((point) => point.na.length > 0);
  return (
    <div className="rec-stack">
      <h3 className="label">
        {group.form} · {group.title}
      </h3>
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">Assessment point</th>
              <th scope="col">Page</th>
              <th scope="col">Line</th>
              <th scope="col">NA</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((point) => {
              const current = references[point.code];
              const na = current === "NA";
              const page = current && current !== "NA" ? current.page : "";
              const line = current && current !== "NA" ? current.line : "";
              const set = (next: IntakeValues["references"][string] | undefined) => {
                const copy = { ...references };
                if (next === undefined) delete copy[point.code];
                else copy[point.code] = next;
                onChange(copy);
              };
              return (
                <tr key={point.code}>
                  <th scope="row">
                    {point.heading ? <span className="caption rec-muted">{point.heading}</span> : null}
                    <span className="code">{point.code}</span> {point.label}
                  </th>
                  <td>
                    <input className="rec-input" aria-label={`${point.code} page`} inputMode="numeric" value={page} disabled={!editable || na} onChange={(event) => set({ page: event.target.value, line })} />
                  </td>
                  <td>
                    <input className="rec-input" aria-label={`${point.code} line`} value={line} disabled={!editable || na} onChange={(event) => set({ page, line: event.target.value })} />
                  </td>
                  <td>
                    <Checkbox label={<span className="sr-only">{point.code} not applicable</span>} checked={na} disabled={!editable} onChange={(event) => set(event.target.checked ? "NA" : undefined)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden.length > 0 ? (
        <p className="caption rec-muted">
          Left out from your scoping answers: {hidden.map((point) => `${point.code} ${naLabel(point.na)}`).join("; ")}.
        </p>
      ) : null}
    </div>
  );
}

function Agreements({
  protocolId,
  editable,
  mine,
  researchers,
  wording,
  gaps,
}: {
  protocolId: string;
  editable: boolean;
  mine: { memberId: string | null; declarationsAt: string | null; consentsAt: string | null };
  researchers: Researcher[];
  wording: { declarations: string[]; consents: string[] };
  gaps: IntakeGap[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function agree(kind: "DECLARATIONS" | "F28_CONSENT", agreed: boolean) {
    setBusy(true);
    setError(null);
    const result = await setAgreementAction({ protocolId, kind, agreed });
    setBusy(false);
    if (!result.ok) setError(result.message);
    router.refresh();
  }
  const when = (at: string | null) => (at ? `Agreed ${new Date(at).toLocaleDateString("en-PH", { dateStyle: "medium" })}` : "Not yet");
  return (
    <section id="agreements" className="rec-card rec-stack" aria-labelledby="intake-agreements">
      <h2 id="intake-agreements" className="heading">
        Declarations and consents
      </h2>
      <p className="body-sm rec-muted">Each researcher answers on their own account, then signs F-27 and F-28 on the Forms tab. Withdrawing an answer voids your signature on that form.</p>
      <h3 className="label">F-27 Declaration(s) by the Researcher(s)/Proponent(s)</h3>
      <ul className="body">
        {wording.declarations.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {mine.memberId ? (
        <Checkbox label="I agree to these declarations." checked={Boolean(mine.declarationsAt)} disabled={!editable || busy} onChange={(event) => void agree("DECLARATIONS", event.target.checked)} />
      ) : null}
      <h3 className="label">F-28 Consent</h3>
      <p className="body-sm">The General Privacy Statement is printed in full on F-28; open it from the Forms tab.</p>
      <ul className="body">
        {wording.consents.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {mine.memberId ? (
        <Checkbox label="I give these consents." checked={Boolean(mine.consentsAt)} disabled={!editable || busy} onChange={(event) => void agree("F28_CONSENT", event.target.checked)} />
      ) : null}
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">Researcher</th>
              <th scope="col">F-27 declarations</th>
              <th scope="col">F-28 consents</th>
            </tr>
          </thead>
          <tbody>
            {researchers.map((researcher) => (
              <tr key={researcher.memberId}>
                <th scope="row">{researcher.name}</th>
                <td>{when(researcher.declarationsAt)}</td>
                <td>{when(researcher.consentsAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Gaps gaps={gaps} />
    </section>
  );
}
