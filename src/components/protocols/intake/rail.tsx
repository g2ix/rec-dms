"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Check, CircleAlert } from "lucide-react";
import { Icon } from "@/components/icons";
import type { RailKey, RailSection } from "@/lib/intake/rail";

/** Scrolls to a section of the Intake page and keeps its id in the address bar. */
export function goToSection(key: string, reduced: boolean) {
  const target = document.getElementById(key);
  if (!target) return;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  window.history.replaceState(null, "", `#${key}`);
  const heading = target.querySelector<HTMLElement>("h2");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus({ preventScroll: true });
}

/** The section in view: the last one whose top has passed a line just under the sticky headers. */
function useSectionInView(keys: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(keys[0] ?? null);
  useEffect(() => {
    const elements = keys.map((key) => document.getElementById(key)).filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = keys.find((key) => visible.get(key));
        if (first) setCurrent(first);
      },
      // A band across the upper third of the viewport: the section crossing it is the one being read.
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, [keys]);
  return current;
}

export function IntakeRail({ sections }: { sections: RailSection[] }) {
  const reduced = Boolean(useReducedMotion());
  // The key list, not the array identity, decides what to observe: a refresh must not re-observe.
  const stableKeys = useStableKeys(sections.map((section) => section.key).join(","));
  const current = useSectionInView(stableKeys);
  return (
    <nav className="rec-intake-rail" aria-label="Intake sections">
      <ol className="rec-intake-rail__list">
        {sections.map((section, index) => {
          const active = current === section.key;
          const left = section.missing.length;
          return (
            <li key={section.key}>
              <a
                href={`#${section.key}`}
                className="rec-intake-rail__item"
                aria-current={active ? "location" : undefined}
                data-testid={`rail-${section.key}`}
                onClick={(event) => {
                  event.preventDefault();
                  goToSection(section.key, reduced);
                }}
              >
                {active ? (
                  <motion.span
                    layoutId="intake-rail-marker"
                    className="rec-intake-rail__marker"
                    transition={reduced ? { duration: 0.12 } : { duration: 0.24, ease: [0.34, 1.56, 0.64, 1] }}
                  />
                ) : null}
                <span className="rec-intake-rail__step caption" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="rec-intake-rail__label body-sm">{section.label}</span>
                <RailStatus missing={left} />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function useStableKeys(keyList: string): string[] {
  const [keys, setKeys] = useState(() => keyList.split(","));
  useEffect(() => setKeys(keyList.split(",")), [keyList]);
  return keys;
}

/** Color, icon and word: "Done", or "3 missing". */
export function RailStatus({ missing }: { missing: number }) {
  return missing === 0 ? (
    <span className="rec-intake-status rec-intake-status--done caption" data-testid="rail-status">
      <Icon icon={Check} size={14} />
      Done
    </span>
  ) : (
    <span className="rec-intake-status rec-intake-status--missing caption" data-testid="rail-status">
      <Icon icon={CircleAlert} size={14} />
      {missing} missing
    </span>
  );
}

/** A section of the page: a scroll target named after its rail key, with its status beside the heading. */
export function IntakeSectionHead({ id, title, missing, children }: { id: RailKey | "preview"; title: string; missing?: number; children?: React.ReactNode }) {
  return (
    <div className="rec-card__head">
      <h2 id={`${id}-heading`} className="heading">
        {title}
      </h2>
      {missing === undefined ? null : <RailStatus missing={missing} />}
      {children}
    </div>
  );
}
