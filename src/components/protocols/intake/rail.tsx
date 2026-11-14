"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import type { RailKey, RailSection } from "@/lib/intake/rail";

export const STEP_EVENT = "rec:intake-step";

/**
 * Opens a step of the Intake page (or the forms preview) and keeps its id in the address bar.
 * The page listens for the event; callers outside it (the submit bar, the preview dialog) only name the step.
 */
export function goToSection(key: string) {
  window.history.replaceState(null, "", `#${key}`);
  window.dispatchEvent(new CustomEvent<string>(STEP_EVENT, { detail: key }));
}

/** The step list beside the current step: progress, one row per step, and what else the checklist needs. */
export function IntakeRail({
  sections,
  current,
  onSelect,
  alsoNeeded,
  overviewHref,
  flags = {},
}: {
  sections: RailSection[];
  /** INTAKE-04: sections a returner commented on, with who ("Adviser", "REC Staff"). Shown as a red "!". */
  flags?: Partial<Record<RailKey, string[]>>;
  current: string;
  onSelect: (key: RailKey) => void;
  /** "Account approval by REC Staff · 1 detail · 4 forms": the checklist outside these steps. Null hides the box. */
  alsoNeeded: string | null;
  overviewHref: string;
}) {
  const done = sections.filter((section) => section.missing.length === 0).length;
  const percent = sections.length === 0 ? 100 : Math.round((done / sections.length) * 100);
  return (
    <nav className="rec-intake-rail" aria-label="Intake sections">
      <div className="rec-intake-rail__head">
        <h2 className="subheading">Prepare this version</h2>
        <p className="label rec-muted">
          {done} of {sections.length} done
        </p>
      </div>
      <div className="rec-intake-rail__bar" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={sections.length} aria-valuenow={done}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <ol className="rec-intake-rail__list">
        {sections.map((section, index) => {
          const active = current === section.key;
          const left = section.missing.length;
          return (
            <li key={section.key}>
              <a
                href={`#${section.key}`}
                className="rec-intake-rail__item"
                aria-current={active ? "step" : undefined}
                data-done={left === 0 || undefined}
                data-testid={`rail-${section.key}`}
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(section.key);
                }}
              >
                <span className="rec-intake-rail__step" aria-hidden="true">
                  {left === 0 ? <Icon icon={Check} size={14} /> : index + 1}
                </span>
                <span className="rec-intake-rail__label">{section.label}</span>
                {flags[section.key]?.length ? (
                  <span className="rec-flag" title={`Comment from the ${flags[section.key]!.join(" and ")}`} aria-label={`Comment from the ${flags[section.key]!.join(" and ")}`} data-testid={`rail-flag-${section.key}`}>
                    !
                  </span>
                ) : null}
                <RailStatus missing={left} />
              </a>
            </li>
          );
        })}
      </ol>
      {alsoNeeded ? (
        <div className="rec-intake-rail__also">
          <p className="label">Also needed to submit</p>
          <p className="caption rec-muted">{alsoNeeded}</p>
          <Link className="rec-intake-rail__also-link label" href={overviewHref}>
            See the full checklist
          </Link>
        </div>
      ) : null}
    </nav>
  );
}

/** "Done" or "3 missing", in words as well as color. */
export function RailStatus({ missing }: { missing: number }) {
  return missing === 0 ? (
    <span className="rec-intake-status rec-intake-status--done caption" data-testid="rail-status">
      Done
    </span>
  ) : (
    <span className="rec-intake-status rec-intake-status--missing caption" data-testid="rail-status">
      {missing} missing
    </span>
  );
}
