"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "motion/react";
import { DocumentsSection } from "@/components/protocols/intake/documents-section";
import { FormsPreview, type PreviewForm } from "@/components/protocols/intake/forms-preview";
import { IntakeSigningSection } from "@/components/protocols/intake/signing-section";
import { IntakeRail, STEP_EVENT } from "@/components/protocols/intake/rail";
import { useSubmissionChecklist } from "@/components/protocols/submission-checklist";
import { FundingSources, StudyFields, useStudySaver } from "@/components/protocols/intake/study-section";
import { SubmitBar } from "@/components/protocols/intake/submit-bar";
import { ReturnedView, type ReturnedData, type ReturnedNote } from "@/components/protocols/intake/returned-view";
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
import { STEP_INTROS, firstMissingSection, stepOfHash, type RailKey, type RailSection } from "@/lib/intake/rail";
import { groupLeft, type ChecklistItem, type ChecklistTab, type SubmissionChecklist } from "@/lib/protocols/checklist";
import type { IntakeSigningView } from "@/lib/intake/signing-view";
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

/** Which intake gaps explain a checklist item, so a section lists every message, not just the first. */
const GAP_SECTION_OF_ITEM: Record<string, IntakeGap["section"]> = {
  "intake.scoping": "scoping",
  "intake.coi": "coi",
  "intake.budget": "budget",
  "intake.references": "references",
  "intake.actions": "actions",
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

  // Created in an effect, not a memo: the cleanup disposes the queue it made, so a remount (React's
  // development double mount, or a re-render after hydration) starts a live queue instead of
  // keeping a disposed one that drops every save.
  const [queue, setQueue] = useState<AutosaveQueue | null>(null);
  useEffect(() => {
    if (!editable) {
      setQueue(null);
      return;
    }
    const created = createAutosaveQueue({
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
    setQueue(created);
    return () => created.dispose();
  }, [editable, protocolId, router, refreshSoon]);
  useAutosaveLifecycle(queue, editable);
  const saver = useStudySaver(protocolId, page.canEditStudy);

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
  const steps = useMemo(() => page.rail.map((section) => section.key), [page.rail]);
  const [current, setCurrent] = useState<RailKey | "preview">(() => (page.returned ? "actions" : firstMissingSection(page.rail) ?? steps[0] ?? "study"));
  // Return comments by the section they are about: a red "!" on the rail and the comment at the top of the step.
  const notesBySection = useMemo(() => {
    const out: Partial<Record<RailKey, ReturnedNote[]>> = {};
    for (const note of page.returned?.notes ?? []) {
      if (!note.section) continue;
      const key = note.section as RailKey;
      (out[key] ??= []).push(note);
    }
    return out;
  }, [page.returned]);
  const flags = useMemo(() => {
    const out: Partial<Record<RailKey, string[]>> = {};
    for (const [key, notes] of Object.entries(notesBySection)) out[key as RailKey] = [...new Set((notes ?? []).filter((note) => !note.done).map((note) => note.roleLabel))];
    return out;
  }, [notesBySection]);
  // Steps the person has opened and left: going back to one shows its empty required fields.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const stepRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const flushStudy = saver.flush;

  const open = useCallback(
    (next: RailKey | "preview") => {
      const previous = currentRef.current;
      if (previous !== next) {
        setLeft((seen) => (seen.has(previous) ? seen : new Set(seen).add(previous)));
        moved.current = true;
      }
      setCurrent(next);
      window.history.replaceState(null, "", `#${next}`);
      // Whatever was typed on the step being left is saved now, not after the debounce.
      void flushStudy();
      void queue?.flushAll();
    },
    [queue, flushStudy],
  );

  // Arriving with #step (from the Overview checklist, the header or a preview link) opens that step.
  useEffect(() => {
    const fromHash = stepOfHash(window.location.hash, steps);
    if (fromHash) setCurrent(fromHash);
    // Only on arrival: later changes come through open().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    function onStep(event: Event) {
      const next = stepOfHash(String((event as CustomEvent<string>).detail ?? ""), steps);
      if (next) open(next);
    }
    function onHash() {
      const next = stepOfHash(window.location.hash, steps);
      if (next) open(next);
    }
    window.addEventListener(STEP_EVENT, onStep);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener(STEP_EVENT, onStep);
      window.removeEventListener("hashchange", onHash);
    };
  }, [steps, open]);

  // A new step starts at its heading: scroll back up when the heading is out of view, and move focus to it.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const target = stepRef.current;
    if (!target) return;
    const top = target.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    const heading = target.querySelector<HTMLElement>("h2");
    heading?.focus({ preventScroll: true });
  }, [current, reduced]);

  // "Saved just now": the latest save from the intake queue or the study fields.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const saving = saver.ui.state === "saving" || Object.values(ui).some((entry) => entry?.state === "saving");
  const anySaved = saver.ui.state === "saved" || Object.values(ui).some((entry) => entry?.state === "saved");
  useEffect(() => {
    if (anySaved && !saving) setSavedAt(Date.now());
  }, [anySaved, saving, saver.ui, ui]);
  useEffect(() => {
    if (savedAt == null) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [savedAt]);

  const checklist = useSubmissionChecklist();
  const alsoNeeded = checklist ? alsoNeededSummary(checklist) : null;

  const index = current === "preview" ? -1 : steps.indexOf(current);
  const back: RailKey | null = current === "preview" ? (steps[steps.length - 1] ?? null) : index > 0 ? (steps[index - 1] ?? null) : null;
  const next: RailKey | "preview" | null = current === "preview" ? null : index < steps.length - 1 ? (steps[index + 1] ?? null) : "preview";
  const missing = current === "preview" ? 0 : missingOf(current);
  const revisit = left.has(current);
  // The rows the server still counts as missing, highlighted once the table has been started or the step is reopened
  // (never on the first look at an empty table, as the Study fields).
  const neededReferences = useMemo<ReadonlySet<string>>(() => {
    if (!revisit && Object.keys(values.references).length === 0) return new Set();
    return new Set(gaps.find((gap) => gap.section === "references")?.detail?.codes ?? []);
  }, [gaps, revisit, values.references]);
  const title = current === "preview" ? "Preview forms" : (rail(current)?.label ?? "");
  const intro =
    current === "preview"
      ? "Filled from your answers. Read-only: change a value where you answer it."
      : current === "actions" && page.returned
        ? "What happened, what to fix, and where your resubmission goes next."
        : STEP_INTROS[current];

  return (
    <div className="rec-intake">
      {!editable ? <p className="rec-alert" role="status">This version is submitted, or you are not a proponent on it. The answers are shown read-only.</p> : null}
      <div className="rec-intake__grid">
        <IntakeRail sections={page.rail} current={current} onSelect={open} alsoNeeded={alsoNeeded} overviewHref={`/app/protocols/${protocolId}`} flags={flags} />

        <div className="rec-intake__body" ref={stepRef}>
          <div className="rec-intake-step__head">
            <div className="rec-intake-step__meta">
              <p className="code rec-muted">{current === "preview" ? "Generated forms" : `Step ${index + 1} of ${steps.length}`}</p>
              {missing > 0 ? <p className="label rec-intake-status--missing">{missing} missing</p> : null}
            </div>
            <h2 id="step-heading" className="rec-intake-step__title" tabIndex={-1}>
              {title}
            </h2>
            <p className="body-sm rec-muted">{intro}</p>
            <details className="rec-intake-howto">
              <summary className="label">How intake works</summary>
              <p className="body-sm rec-muted">
                Everything for this version is on this tab. F-26, F-27, F-28, F-30 and your columns of F-35 and F-36 are filled from it; you do not fill those forms one by one. Each step saves as you type, and Preview forms shows how they print.
              </p>
            </details>
          </div>

          <section id={current} className="rec-card rec-intake-card" aria-labelledby="step-heading" data-testid={current === "team" ? "team-section" : undefined}>
            {current !== "preview" && current !== "actions" && notesBySection[current]?.length ? (
              <ul className="rec-fix-rows rec-fix-rows--inline" aria-label="Comments on this section">
                {notesBySection[current]!.map((note) => (
                  <li key={note.id} className="rec-fix-row" data-testid="section-note" data-done={note.done || undefined}>
                    <p className="label">
                      <span className="rec-flag" aria-hidden="true">
                        !
                      </span>{" "}
                      {note.roleLabel}
                      {note.done ? " · Done" : ""}
                    </p>
                    <p className="body-sm rec-pre-wrap">{note.body}</p>
                  </li>
                ))}
              </ul>
            ) : null}

            {current === "actions" && page.returned ? (
              <ReturnedView
                protocolId={protocolId}
                data={page.returned}
                actions={values.actions}
                onAction={editable ? (code, value) => change("actions", { ...values, actions: { ...values.actions, [code]: value } }) : null}
                status={status("actions")}
                maxBytes={page.documents.maxBytes}
              />
            ) : current === "actions" ? (
              actionPoints.length > 0 ? (
                <>
                  <p className="body-sm rec-muted">For each point the panel flagged, say what you changed and where (page and paragraph number). Every researcher signs F-38 under Agree and sign; then the adviser signs it.</p>
                  {actionPoints.map((point) => (
                    <div key={point.code} className="rec-field rec-field--wide">
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
              )
            ) : null}

            {current === "study" ? <StudyFields values={page.details} editable={page.canEditStudy} saver={saver} revisit={revisit} /> : null}

            {current === "team" ? team : null}

            {current === "funding" ? (
              <>
                <FundingSources initial={page.details.funding} editable={page.canEditStudy} saver={saver} onCodes={setFundingCodes} />
                <BudgetSection
                  lines={values.budgetLines}
                  open={budgetColumnsFor(fundingCodes)}
                  editable={editable}
                  feeEstimate={feeEstimate}
                  onChange={(budgetLines) => change("budget", { ...values, budgetLines })}
                  status={status("budget")}
                />
              </>
            ) : null}

            {current === "participants" ? (
              <>
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
                  <div className="rec-field rec-field--wide">
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
                <p className="caption rec-muted">Reviewers still see the points a no marks N/A, with your answer as the reason.</p>
                {status("scoping")}
              </>
            ) : null}

            {current === "coi" ? (
              <>
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
                  <div className="rec-field rec-field--wide">
                    <label className="rec-field__label" htmlFor="coi-text">
                      Specify the conflict of interest
                    </label>
                    <Textarea id="coi-text" value={values.coi.text ?? ""} disabled={!editable} onChange={(event) => change("coi", { ...values, coi: { ...values.coi, text: event.target.value } })} />
                  </div>
                ) : null}
                {status("coi")}
              </>
            ) : null}

            {current === "references" ? (
              groups.length === 0 ? (
                <p className="body-sm">This version&apos;s forms ask for no page and line references.</p>
              ) : (
                <>
                  <p className="body-sm rec-muted">
                    Give the page and line in your uploaded proposal (F-35) and Informed Consent Form (F-36). Tick NA when a point does not apply. Points your answers under Participants &amp; consent mark N/A are left out.
                    {page.referencesOptional ? " On this revision they are optional: update them where your changes moved something." : ""}
                  </p>
                  {groups.map((group) => (
                    <ReferenceGroup
                      key={group.form}
                      group={group}
                      references={values.references}
                      needed={neededReferences}
                      editable={editable}
                      onChange={(references) => change("references", { ...values, references })}
                    />
                  ))}
                  {status("references")}
                </>
              )
            ) : null}

            {current === "documents" ? <DocumentsSection protocolId={protocolId} {...page.documents} /> : null}

            {current === "sign" ? (
              <>
                <Agreements protocolId={protocolId} editable={editable} mine={mine} wording={wording} />
                {page.signing ? <IntakeSigningSection protocolId={protocolId} signing={page.signing} /> : null}
              </>
            ) : null}

            {current === "preview" ? <FormsPreview protocolId={protocolId} forms={page.forms} /> : null}

            {/* Study names its own empty fields; the other steps list what the checklist still needs once the step is reopened. */}
            {current !== "preview" && current !== "study" && revisit ? missingList(current) : null}

            <div className="rec-intake-card__foot">
              <p className="caption rec-muted rec-intake-card__saved" role="status" aria-live="polite">
                {saving ? "Saving…" : savedAt != null ? savedLabel(savedAt) : editable ? "Answers save as you type" : "Read-only"}
              </p>
              <div className="rec-actions">
                {back ? (
                  <Button type="button" variant="secondary" onClick={() => open(back)}>
                    Back
                  </Button>
                ) : null}
                {next ? (
                  <Button type="button" variant="primary" onClick={() => open(next)}>
                    Next: {next === "preview" ? "Preview forms" : (rail(next)?.label ?? "")}
                  </Button>
                ) : null}
              </div>
            </div>
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

function savedLabel(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "Saved just now";
  return minutes === 1 ? "Saved 1 minute ago" : `Saved ${minutes} minutes ago`;
}

const GROUP_NOUN: Partial<Record<ChecklistTab, [string, string]>> = {
  details: ["detail", "details"],
  forms: ["form", "forms"],
  uploads: ["upload", "uploads"],
  members: ["member", "members"],
};

/** The checklist outside the Intake steps, in one line: "Account approval by REC Staff · 1 detail · 4 forms". */
function alsoNeededSummary(checklist: SubmissionChecklist): string | null {
  const parts: string[] = [];
  for (const group of checklist.groups) {
    const count = groupLeft(group);
    if (count === 0 || group.tab === "intake") continue;
    if (group.tab === "account") {
      parts.push("Account approval by REC Staff");
      continue;
    }
    const noun = GROUP_NOUN[group.tab];
    parts.push(noun ? `${count} ${count === 1 ? noun[0] : noun[1]}` : `${count} ${group.label.toLowerCase()}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
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
  /** INTAKE-04: set on a returned protocol. The "actions" step becomes "Returned for revision". */
  returned?: ReturnedData | null;
  signing: IntakeSigningView | null;
};

/** A section's missing checklist items. An intake item lists every gap message behind it. */
function MissingList({ items, gaps }: { items: ChecklistItem[]; gaps: IntakeGap[] }) {
  if (items.length === 0) return null;
  const lines = items.flatMap((item) => {
    // A researcher's item: its hint already names them and says what is left.
    if (item.key.startsWith("sign.")) return [item.hint ?? item.label];
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
  // Saving and saved are shown once, in the step's footer.
  return null;
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
  needed,
  editable,
  onChange,
}: {
  group: PointGroup;
  references: IntakeValues["references"];
  /** Codes the server's references gap lists; a row filled since then is no longer highlighted. */
  needed: ReadonlySet<string>;
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
              const rowNeeded = needed.has(point.code) && !na && (!page.trim() || !line.trim());
              const neededId = `reference-needed-${group.form}-${point.code}`;
              return (
                <tr key={point.code} className={rowNeeded ? "rec-row--needed" : undefined} data-needed={rowNeeded ? "true" : undefined}>
                  <th scope="row">
                    {point.heading ? <span className="caption rec-muted">{point.heading}</span> : null}
                    <span className="code">{point.code}</span> {point.label}
                    {rowNeeded ? (
                      <p id={neededId} className="rec-field__needed">
                        Still needed
                      </p>
                    ) : null}
                  </th>
                  <td>
                    <input
                      className="rec-input"
                      aria-label={`${point.code} page`}
                      aria-invalid={rowNeeded && !page.trim() ? true : undefined}
                      aria-describedby={rowNeeded ? neededId : undefined}
                      inputMode="numeric"
                      value={page}
                      disabled={!editable || na}
                      onChange={(event) => set({ page: event.target.value, line })}
                    />
                  </td>
                  <td>
                    <input
                      className="rec-input"
                      aria-label={`${point.code} line`}
                      aria-invalid={rowNeeded && !line.trim() ? true : undefined}
                      aria-describedby={rowNeeded ? neededId : undefined}
                      value={line}
                      disabled={!editable || na}
                      onChange={(event) => set({ page, line: event.target.value })}
                    />
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
  wording,
}: {
  protocolId: string;
  editable: boolean;
  mine: { memberId: string | null; declarationsAt: string | null; consentsAt: string | null };
  wording: { declarations: string[]; consents: string[] };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The box follows the click at once; the server's answer (after the refresh) replaces it, and a refusal puts it back.
  const [shown, setShown] = useState<Partial<Record<"DECLARATIONS" | "F28_CONSENT", boolean>>>({});
  useEffect(() => {
    setShown({});
  }, [mine.declarationsAt, mine.consentsAt]);
  const declared = shown.DECLARATIONS ?? Boolean(mine.declarationsAt);
  const consented = shown.F28_CONSENT ?? Boolean(mine.consentsAt);
  async function agree(kind: "DECLARATIONS" | "F28_CONSENT", agreed: boolean) {
    setBusy(true);
    setError(null);
    setShown((current) => ({ ...current, [kind]: agreed }));
    const result = await setAgreementAction({ protocolId, kind, agreed });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setShown((current) => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
    }
    router.refresh();
  }
  return (
    <div id="agreements" className="rec-stack">
      <p className="body-sm rec-muted">Each researcher agrees on their own account, then signs F-27 and F-28 below with one signature. Withdrawing either answer voids your signatures on both forms.</p>
      <h3 className="label">F-27 Declaration(s) by the Researcher(s)/Proponent(s)</h3>
      <ul className="body">
        {wording.declarations.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {mine.memberId ? (
        <Checkbox label="I agree to these declarations." checked={declared} disabled={!editable || busy} onChange={(event) => void agree("DECLARATIONS", event.target.checked)} />
      ) : null}
      <h3 className="label">F-28 Consent</h3>
      <p className="body-sm">The General Privacy Statement is printed in full on F-28; preview it under Preview forms.</p>
      <ul className="body">
        {wording.consents.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
      {mine.memberId ? (
        <Checkbox label="I give these consents." checked={consented} disabled={!editable || busy} onChange={(event) => void agree("F28_CONSENT", event.target.checked)} />
      ) : null}
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
