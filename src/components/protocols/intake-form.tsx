"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { SignatureFields } from "@/components/forms/signature-field";
import { Icon } from "@/components/icons";
import { DocumentsSection } from "@/components/protocols/intake/documents-section";
import { FormsPreview, type PreviewForm } from "@/components/protocols/intake/forms-preview";
import { IntakeRail, IntakeSectionHead, goToSection } from "@/components/protocols/intake/rail";
import { FundingSources, StudyFields, useStudySaver } from "@/components/protocols/intake/study-section";
import { SubmitBar } from "@/components/protocols/intake/submit-bar";
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
import { RESEARCH_TYPE_GAP } from "@/lib/intake/gaps";
import { firstMissingSection, type RailKey, type RailSection } from "@/lib/intake/rail";
import type { FormField } from "@/lib/forms/schema";
import type { ChecklistItem } from "@/lib/protocols/checklist";
import type { SignatureSlotView, SigningPrompt } from "@/lib/signatures/view";
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

/** Which intake gaps explain a checklist item, so a section lists every message, not just the first. */
const GAP_SECTION_OF_ITEM: Record<string, IntakeGap["section"]> = {
  "intake.scoping": "scoping",
  "intake.coi": "coi",
  "intake.budget": "budget",
  "intake.references": "references",
  "intake.actions": "actions",
  "intake.agreements": "agreements",
  "details.study": "study",
  "details.funding": "funding",
};

/**
 * The Intake tab: the one place where the proponents prepare a version. A rail of sections
 * (status from the submission checklist), one scrolling page, the generated forms to preview,
 * and a submit bar. Each section keeps its own data where it was: the Study and Funding fields
 * on the protocol (the Details page), the rest in the intake, the files in the uploads.
 */
export function IntakeForm({
  protocolId,
  editable,
  initialRevision,
  initialValues,
  groups,
  actionPoints,
  fundingCodes: initialFundingCodes,
  gaps,
  feeEstimate,
  mine,
  researchers,
  wording,
  page,
  team,
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
  page: IntakePageProps;
  /** The roster, rendered on the server (the Overview's Team card). */
  team: React.ReactNode;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [ui, setUi] = useState<Partial<Record<IntakeSection, AutosaveUi>>>({});
  const [fundingCodes, setFundingCodes] = useState(initialFundingCodes);
  const revision = useRef(initialRevision);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = Boolean(useReducedMotion());

  // After a save the rail counts, the submit bar and the previews are read again on the server.
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 400);
  }, [router]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const queue = useMemo<AutosaveQueue | null>(() => {
    if (!editable) return null;
    return createAutosaveQueue({
      getRevision: () => revision.current,
      save: async ({ path, value, expectedRevision }) => saveIntakeAction({ protocolId, section: path, value, expectedRevision }),
      keepaliveSave: ({ fields, expectedRevision }) => postKeepalive(`/api/protocols/${protocolId}/intake`, keepaliveSavePayload({ fields, expectedRevision })),
      hooks: {
        onUi: (path, next) => {
          setUi((current) => ({ ...current, [path]: next }));
          if (next.state === "saved") refreshSoon();
        },
        onRevision: (next) => {
          revision.current = next;
        },
        onSignaturesVoided: () => router.refresh(),
      },
    });
  }, [editable, protocolId, router, refreshSoon]);
  useEffect(() => () => queue?.dispose(), [queue]);
  useAutosaveLifecycle(queue, editable);
  const saver = useStudySaver(protocolId, page.canEditStudy);

  // Arriving with #section (from the Overview checklist or a preview link) scrolls there once.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) goToSection(hash, true);
  }, []);

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
  const rail = (key: RailKey) => page.rail.find((section) => section.key === key);
  const missingOf = (key: RailKey) => rail(key)?.missing.length ?? 0;
  const missingList = (key: RailKey) => <MissingList items={rail(key)?.missing ?? []} gaps={gaps} />;
  const open = budgetColumnsFor(fundingCodes);
  const shown = new Set(page.rail.map((section) => section.key));

  return (
    <div className="rec-intake">
      <div className="rec-intake__head">
        <div className="rec-stack rec-intake__intro">
          <h2 className="heading">Prepare this version</h2>
          <p className="body-sm rec-muted">
            Everything for this version is on this page. F-26, F-27, F-28, F-30 and your columns of F-35 and F-36 are filled from it; you do not fill those forms one by one. Answers save as you type.
          </p>
          {!editable ? <p className="body-sm">This version is submitted, or you are not a proponent on it. The answers are shown read-only.</p> : null}
        </div>
        <Button type="button" variant="secondary" onClick={() => goToSection("preview", reduced)}>
          <Icon icon={Eye} size={16} />
          Preview forms
        </Button>
      </div>

      <div className="rec-intake__grid">
        <IntakeRail sections={page.rail} />
        <div className="rec-intake__body rec-stack">
          {shown.has("actions") ? (
            <section id="actions" className="rec-card rec-stack rec-intake__section" aria-labelledby="actions-heading">
              <IntakeSectionHead id="actions" title="Actions taken (F-38)" missing={missingOf("actions")} />
              {actionPoints.length > 0 ? (
                <>
                  <p className="body-sm rec-muted">For each point the panel flagged, say what you changed and where (page and paragraph number). Every researcher, then the adviser, signs F-38 on the Forms tab.</p>
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
                </>
              ) : (
                <p className="body-sm">No points were flagged for action on this version.</p>
              )}
              {missingList("actions")}
            </section>
          ) : null}

          <section id="study" className="rec-card rec-stack rec-intake__section" aria-labelledby="study-heading">
            <IntakeSectionHead id="study" title="Study" missing={missingOf("study")} />
            <p className="body-sm rec-muted">Shown on every form. F-27 prints these as they are here. REC Staff see the same fields on the Details tab.</p>
            <StudyFields values={page.details} editable={page.canEditStudy} saver={saver} />
            {missingList("study")}
          </section>

          <div id="team" className="rec-intake__section" data-testid="team-section">
            {team}
            {missingOf("team") > 0 ? <div className="rec-card">{missingList("team")}</div> : null}
          </div>

          <section id="funding" className="rec-card rec-stack rec-intake__section" aria-labelledby="funding-heading">
            <IntakeSectionHead id="funding" title="Funding and budget" missing={missingOf("funding")} />
            <FundingSources initial={page.details.funding} editable={page.canEditStudy} saver={saver} onCodes={setFundingCodes} />
            <BudgetSection
              lines={values.budgetLines}
              open={open}
              editable={editable}
              feeEstimate={feeEstimate}
              onChange={(budgetLines) => change("budget", { ...values, budgetLines })}
              status={status("budget")}
            />
            {missingList("funding")}
          </section>

          <section id="participants" className="rec-card rec-stack rec-intake__section" aria-labelledby="participants-heading">
            <IntakeSectionHead id="participants" title="Participants and consent" missing={missingOf("participants")} />
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
            {missingList("participants")}
          </section>

          <section id="coi" className="rec-card rec-stack rec-intake__section" aria-labelledby="coi-heading">
            <IntakeSectionHead id="coi" title="Conflict of interest" missing={missingOf("coi")} />
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
            {missingList("coi")}
          </section>

          <section id="references" className="rec-card rec-stack rec-intake__section" aria-labelledby="references-heading">
            <IntakeSectionHead id="references" title="Where to find it" missing={missingOf("references")} />
            {groups.length === 0 ? (
              <p className="body-sm">This version&apos;s forms ask for no page and line references.</p>
            ) : (
              <>
                <p className="body-sm rec-muted">
                  The page and line in your uploaded proposal (F-35) and Informed Consent Form (F-36) where each assessment point can be found. Tick NA when a point does not apply. Points your answers under Participants and consent mark N/A are left out.
                  {page.referencesOptional ? " On this revision they are optional: update them where your changes moved something." : ""}
                </p>
                {groups.map((group) => (
                  <ReferenceGroup key={group.form} group={group} references={values.references} editable={editable} onChange={(references) => change("references", { ...values, references })} />
                ))}
                {status("references")}
              </>
            )}
            {missingList("references")}
          </section>

          <section id="documents" className="rec-card rec-stack rec-intake__section" aria-labelledby="documents-heading">
            <IntakeSectionHead id="documents" title="Documents" missing={missingOf("documents")} />
            <DocumentsSection protocolId={protocolId} {...page.documents} />
            {missingList("documents")}
          </section>

          <section id="sign" className="rec-card rec-stack rec-intake__section" aria-labelledby="sign-heading">
            <IntakeSectionHead id="sign" title="Agree and sign" missing={missingOf("sign")} />
            <Agreements protocolId={protocolId} editable={editable} mine={mine} researchers={researchers} wording={wording} />
            {page.signing.length > 0 ? (
              <div className="rec-stack" data-testid="signing">
                <h3 className="subheading">Sign F-27 and F-28</h3>
                <p className="body-sm rec-muted">After you agree above, sign each form below. Every researcher signs on their own account.</p>
                {page.signing.map((form) => (
                  <div key={form.instanceId} className="rec-stack rec-intake__sign">
                    <h4 className="label">
                      <span className="code">{form.code}</span> {form.title}
                    </h4>
                    {form.fields.map((field) => (
                      <SignatureFields key={field.id} field={field} slots={form.slots[field.id] ?? []} signing={form.signing} />
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {missingList("sign")}
          </section>

          <section id="preview" className="rec-card rec-stack rec-intake__section" aria-labelledby="preview-heading">
            <IntakeSectionHead id="preview" title="Preview forms" />
            <p className="body-sm rec-muted">Filled from this page. Read-only: change a value where you answer it.</p>
            <FormsPreview protocolId={protocolId} forms={page.forms} />
          </section>
        </div>
      </div>

      <SubmitBar
        protocolId={protocolId}
        missing={page.missingCount}
        firstSection={firstMissingSection(page.rail)}
        accountApproved={page.accountApproved}
        leader={page.leader}
        submit={page.submit}
      />
    </div>
  );
}

/** What the server adds for the single-glance page (src/server/intake/page.ts). */
export type IntakePageProps = {
  rail: RailSection[];
  missingCount: number;
  accountApproved: boolean;
  leader: boolean;
  submit: { taskId: string; to: "ADVISER" | "REC"; ready: boolean } | null;
  details: {
    title: string;
    institution: string;
    institutionAddress: string;
    researchTypeCodes: string[];
    researchTypeOther: string;
    durationMonths: number | null;
    expectedParticipants: number | null;
    studySite: string;
    funding: { code: string; detail: string }[];
  };
  canEditStudy: boolean;
  referencesOptional: boolean;
  documents: {
    required: { kind: string; label: string }[];
    files: { id: string; kind: string; originalName: string; scanStatus: string; size: number }[];
    maxBytes: number;
    canUpload: boolean;
  };
  forms: PreviewForm[];
  signing: {
    instanceId: string;
    code: string;
    title: string;
    fields: FormField[];
    slots: Record<string, SignatureSlotView[]>;
    signing: SigningPrompt;
  }[];
};

/** A section's missing checklist items. An intake item lists every gap message behind it. */
function MissingList({ items, gaps }: { items: ChecklistItem[]; gaps: IntakeGap[] }) {
  if (items.length === 0) return null;
  const lines = items.flatMap((item) => {
    const section = GAP_SECTION_OF_ITEM[item.key];
    // The research type has its own item, so the study item leaves that message out (as the checklist does).
    const messages = section ? gaps.filter((gap) => gap.section === section && !(item.key === "details.study" && gap.message === RESEARCH_TYPE_GAP)).map((gap) => gap.message) : [];
    if (messages.length > 0) return messages;
    return [item.hint && item.hint !== item.label ? `${item.label}: ${item.hint}` : item.label];
  });
  return (
    <div className="rec-missing" role="note">
      <p className="label">Still missing</p>
      <ul className="body-sm">
        {[...new Set(lines)].map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
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
}: {
  lines: BudgetLine[];
  open: BudgetColumn[];
  editable: boolean;
  feeEstimate: number | null;
  onChange: (lines: BudgetLine[]) => void;
  status: React.ReactNode;
}) {
  const fee = lines.find((line) => line.fee);
  const update = (id: string, patch: Partial<BudgetLine>) => onChange(lines.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  const remove = (id: string) => onChange(lines.filter((line) => line.id !== id));
  const sum = (column: BudgetColumn | "total") =>
    lines.reduce((total, line) => total + (column === "total" ? lineTotal(line) : (line[column] ?? 0)), 0);
  return (
    <div className="rec-stack" id="budget">
      <h3 className="subheading">Detailed budget (F-30)</h3>
      {open.length === 0 ? (
        <p className="body-sm">
          Choose the source of funds above first. Each source opens its column: researcher-funded opens Personal, an agency or other source opens External, the institution opens Internal.
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
            <h4 className="label">{BUDGET_SECTION_LABELS[section]}</h4>
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
    </div>
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
      <h3 className="subheading">
        <span className="code">{group.form}</span> {group.title}
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
}: {
  protocolId: string;
  editable: boolean;
  mine: { memberId: string | null; declarationsAt: string | null; consentsAt: string | null };
  researchers: Researcher[];
  wording: { declarations: string[]; consents: string[] };
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
    <div id="agreements" className="rec-stack">
      <p className="body-sm rec-muted">Each researcher agrees on their own account, then signs F-27 and F-28 below. Withdrawing an answer voids your signature on that form.</p>
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
      <p className="body-sm">The General Privacy Statement is printed in full on F-28; preview it under Preview forms.</p>
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
    </div>
  );
}
