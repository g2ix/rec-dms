"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FundingChoices, ResearchTypeChoices } from "@/components/protocols/study-choices";
import { Field, type SaveState } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { registerAutosaveFlusher } from "@/lib/forms/flush-registry";
import { isAllCapsTitle } from "@/lib/protocols/format";
import { saveStudyAction } from "@/server/intake/actions";

/** The fields of the protocol the Study and Funding sections write (the Details page's fields). */
export type StudyPatch = {
  title?: string;
  institution?: string;
  institutionAddress?: string;
  researchTypeCodes?: string[];
  researchTypeOther?: string;
  durationMonths?: number | null;
  expectedParticipants?: number | null;
  studySite?: string;
  funding?: { code: string; detail: string }[];
};

type SaverUi = { state: SaveState; error: string | null; field: keyof StudyPatch | null };

/**
 * Autosave of the protocol fields on the Intake page: debounced, flushed before Submit and Sign
 * (the shared flush registry) and when the page is hidden. Saves only the fields that changed.
 */
export function useStudySaver(protocolId: string, enabled: boolean) {
  const router = useRouter();
  const pending = useRef<StudyPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ui, setUi] = useState<SaverUi>({ state: "idle", error: null, field: null });

  const flush = useCallback(async (): Promise<"ok" | "failed"> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    const fields = Object.keys(patch) as (keyof StudyPatch)[];
    if (fields.length === 0) return "ok";
    pending.current = {};
    setUi({ state: "saving", error: null, field: null });
    try {
      const result = await saveStudyAction({ protocolId, patch });
      if (!result.ok) {
        setUi({ state: "idle", error: result.message, field: fields.length === 1 ? fields[0]! : null });
        return "failed";
      }
      setUi({ state: "saved", error: null, field: null });
      // The rail, the submit bar and the F-27 preview read these fields on the server.
      router.refresh();
      return "ok";
    } catch {
      pending.current = { ...patch, ...pending.current };
      setUi({ state: "idle", error: "Not saved yet. Check your connection; it will retry on the next change.", field: null });
      return "failed";
    }
  }, [protocolId, router]);

  useEffect(() => {
    if (!enabled) return;
    const unregister = registerAutosaveFlusher(flush);
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      unregister();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [enabled, flush]);

  const schedule = useCallback(
    (patch: StudyPatch) => {
      if (!enabled) return;
      pending.current = { ...pending.current, ...patch };
      setUi((current) => ({ ...current, error: null }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [enabled, flush],
  );

  /** A field the browser can check on its own: shows the problem and does not save until it is fixed. */
  const reject = useCallback((field: keyof StudyPatch, message: string) => {
    delete pending.current[field];
    setUi({ state: "idle", error: message, field });
  }, []);

  return { schedule, reject, flush, ui };
}

type StudyValues = {
  title: string;
  institution: string;
  institutionAddress: string;
  researchTypeCodes: string[];
  researchTypeOther: string;
  durationMonths: number | null;
  expectedParticipants: number | null;
  studySite: string;
};

function wholeNumber(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : "invalid";
}

export function StudyFields({ values, editable, saver }: { values: StudyValues; editable: boolean; saver: ReturnType<typeof useStudySaver> }) {
  const [title, setTitle] = useState(values.title);
  const [institution, setInstitution] = useState(values.institution);
  const [address, setAddress] = useState(values.institutionAddress);
  const [typeCodes, setTypeCodes] = useState(values.researchTypeCodes);
  const [typeOther, setTypeOther] = useState(values.researchTypeOther);
  const [duration, setDuration] = useState(values.durationMonths == null ? "" : String(values.durationMonths));
  const [participants, setParticipants] = useState(values.expectedParticipants == null ? "" : String(values.expectedParticipants));
  const [site, setSite] = useState(values.studySite);
  const errorFor = (field: keyof StudyPatch) => (saver.ui.field === field ? (saver.ui.error ?? undefined) : undefined);
  const stateFor = (field: keyof StudyPatch): SaveState => (saver.ui.field === null || saver.ui.field === field ? saver.ui.state : "idle");

  return (
    <div className="rec-form rec-form--inline">
      <Field label="Title" htmlFor="study-title" help="The REC asks that titles not be written in all capitals." error={errorFor("title")} saveState={stateFor("title")}>
        <Input
          id="study-title"
          name="title"
          required
          value={title}
          disabled={!editable}
          onChange={(event) => {
            setTitle(event.target.value);
            if (event.target.value.trim()) saver.schedule({ title: event.target.value });
            else saver.reject("title", "Enter the protocol title.");
          }}
        />
      </Field>
      {isAllCapsTitle(title) ? (
        <p className="rec-alert" role="status">
          This title is in all capitals. The REC asks for sentence case.
        </p>
      ) : null}
      <Field label="Institution" htmlFor="study-institution" help="The proponents' institution for this application." error={errorFor("institution")}>
        <Input
          id="study-institution"
          value={institution}
          disabled={!editable}
          onChange={(event) => {
            setInstitution(event.target.value);
            if (event.target.value.trim()) saver.schedule({ institution: event.target.value });
            else saver.reject("institution", "Enter the institution.");
          }}
        />
      </Field>
      <Field label="Institution address" htmlFor="study-address" optional error={errorFor("institutionAddress")}>
        <Input
          id="study-address"
          value={address}
          disabled={!editable}
          onChange={(event) => {
            setAddress(event.target.value);
            saver.schedule({ institutionAddress: event.target.value });
          }}
        />
      </Field>
      <ResearchTypeChoices
        id="study-type"
        selected={typeCodes}
        other={typeOther}
        disabled={!editable}
        error={errorFor("researchTypeCodes")}
        onToggle={(code, checked) => {
          const next = checked ? [...typeCodes, code] : typeCodes.filter((item) => item !== code);
          setTypeCodes(next);
          if (next.length === 0) saver.reject("researchTypeCodes", "Choose at least one research type.");
          else saver.schedule({ researchTypeCodes: next, researchTypeOther: typeOther });
        }}
        onOther={(value) => {
          setTypeOther(value);
          if (typeCodes.length > 0) saver.schedule({ researchTypeCodes: typeCodes, researchTypeOther: value });
        }}
      />
      <Field label="Duration in months" htmlFor="study-duration" error={errorFor("durationMonths")}>
        <Input
          id="study-duration"
          inputMode="numeric"
          value={duration}
          disabled={!editable}
          onChange={(event) => {
            setDuration(event.target.value);
            const parsed = wholeNumber(event.target.value);
            if (parsed === "invalid") saver.reject("durationMonths", "Enter a whole number of months.");
            else saver.schedule({ durationMonths: parsed });
          }}
        />
      </Field>
      <Field label="Expected participants" htmlFor="study-participants" error={errorFor("expectedParticipants")}>
        <Input
          id="study-participants"
          inputMode="numeric"
          value={participants}
          disabled={!editable}
          onChange={(event) => {
            setParticipants(event.target.value);
            const parsed = wholeNumber(event.target.value);
            if (parsed === "invalid") saver.reject("expectedParticipants", "Enter a whole number of participants.");
            else saver.schedule({ expectedParticipants: parsed });
          }}
        />
      </Field>
      <Field label="Study site" htmlFor="study-site" error={errorFor("studySite")}>
        <Input
          id="study-site"
          value={site}
          disabled={!editable}
          onChange={(event) => {
            setSite(event.target.value);
            saver.schedule({ studySite: event.target.value });
          }}
        />
      </Field>
      {saver.ui.error && saver.ui.field === null ? (
        <p className="rec-field__error" role="alert">
          {saver.ui.error}
        </p>
      ) : null}
    </div>
  );
}

/** The sources of funds (on the protocol). Each source opens its F-30 column in the budget below. */
export function FundingSources({
  initial,
  editable,
  saver,
  onCodes,
}: {
  initial: { code: string; detail: string }[];
  editable: boolean;
  saver: ReturnType<typeof useStudySaver>;
  onCodes: (codes: string[]) => void;
}) {
  const [codes, setCodes] = useState(initial.map((source) => source.code));
  const [details, setDetails] = useState<Record<string, string>>(() => Object.fromEntries(initial.map((source) => [source.code, source.detail])));
  const save = (nextCodes: string[], nextDetails: Record<string, string>) =>
    saver.schedule({ funding: nextCodes.map((code) => ({ code, detail: nextDetails[code] ?? "" })) });
  return (
    <FundingChoices
      id="funding-sources"
      selected={codes}
      details={details}
      disabled={!editable}
      error={saver.ui.field === "funding" ? (saver.ui.error ?? undefined) : undefined}
      onToggle={(code, checked) => {
        const next = checked ? [...codes, code] : codes.filter((item) => item !== code);
        setCodes(next);
        onCodes(next);
        save(next, details);
      }}
      onDetail={(code, value) => {
        const next = { ...details, [code]: value };
        setDetails(next);
        save(codes, next);
      }}
    />
  );
}
