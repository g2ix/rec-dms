"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import { firstMissing, groupLeft, tabCounts, type ChecklistTab, type SubmissionChecklist } from "@/lib/protocols/checklist";

export const CHECKLIST_ID = "submission-checklist";
const REVEAL = "rec:checklist-reveal";

/** Opens the checklist (on narrow screens), scrolls to it and highlights the first group with a gap. */
export function revealChecklist() {
  window.dispatchEvent(new CustomEvent(REVEAL));
}

const ChecklistContext = createContext<SubmissionChecklist | null>(null);

/**
 * Holds the checklist for every protocol tab. Moving between tabs does not re-render the layout,
 * and form autosaves do not refresh the page, so it reloads on each tab change and on window focus.
 */
export function ChecklistProvider({
  protocolId,
  initial,
  children,
}: {
  protocolId: string;
  initial: SubmissionChecklist;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [checklist, setChecklist] = useState(initial);
  const first = useRef(true);

  useEffect(() => setChecklist(initial), [initial]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/protocols/${protocolId}/checklist`, { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as { checklist: SubmissionChecklist | null };
        if (!cancelled && body.checklist) setChecklist(body.checklist);
      } catch {
        // Keep the last checklist; the next tab change or focus tries again.
      }
    }
    if (first.current) first.current = false;
    else void load();
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, [protocolId, pathname]);

  return <ChecklistContext.Provider value={checklist}>{children}</ChecklistContext.Provider>;
}

/** The shared checklist, or null outside a ChecklistProvider. */
export function useSubmissionChecklist(): SubmissionChecklist | null {
  return useContext(ChecklistContext);
}

/** Missing items per tab from the shared checklist, or null outside a ChecklistProvider. */
export function useChecklistCounts(): Partial<Record<ChecklistTab, number>> | null {
  const checklist = useContext(ChecklistContext);
  return checklist ? tabCounts(checklist) : null;
}

export function SubmissionChecklistPanel() {
  const checklist = useContext(ChecklistContext);
  if (!checklist) return null;
  return <ChecklistBody checklist={checklist} />;
}

function ChecklistBody({ checklist }: { checklist: SubmissionChecklist }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const percent = checklist.total === 0 ? 100 : Math.round((checklist.done / checklist.total) * 100);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onReveal() {
      setOpen(true);
      const group = checklist.groups.find((item) => groupLeft(item) > 0);
      setHighlight(group?.tab ?? null);
      requestAnimationFrame(() => {
        const target = group ? document.getElementById(`checklist-${group.tab}`) : document.getElementById(CHECKLIST_ID);
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
      });
      clearTimeout(timer);
      timer = setTimeout(() => setHighlight(null), 2400);
    }
    window.addEventListener(REVEAL, onReveal);
    return () => {
      window.removeEventListener(REVEAL, onReveal);
      clearTimeout(timer);
    };
  }, [checklist]);

  return (
    <aside id={CHECKLIST_ID} className="rec-checklist rec-card" aria-labelledby="checklist-heading" data-open={open || undefined}>
      <div className="rec-checklist__head">
        <h2 id="checklist-heading" className="subheading">
          Before you can submit
        </h2>
        <p className="label rec-muted">
          {checklist.done} of {checklist.total}
        </p>
      </div>
      <div
        className="rec-checklist__bar"
        role="progressbar"
        aria-label="Required items done"
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.done}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <button
        type="button"
        className="rec-checklist__toggle rec-btn rec-btn--ghost"
        aria-expanded={open}
        aria-controls="checklist-body"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide checklist" : "Show checklist"}
      </button>
      <div id="checklist-body" className="rec-checklist__body">
        {checklist.groups.map((group) => {
          const left = groupLeft(group);
          const next = firstMissing(group);
          const href = next?.href ?? group.href;
          return (
            <section
              key={group.tab}
              id={`checklist-${group.tab}`}
              className="rec-checklist__group"
              data-highlight={highlight === group.tab || undefined}
              aria-label={group.label}
            >
              <div className="rec-checklist__group-head">
                <h3 className="rec-checklist__group-name">{group.label}</h3>
                <span className={left === 0 ? "rec-checklist__state rec-checklist__state--done" : "rec-checklist__state"}>
                  {left === 0 ? "Complete" : `${left} left`}
                </span>
                {left > 0 && href && group.href ? (
                  <Link className="rec-checklist__link" href={href}>
                    Open {group.label}
                  </Link>
                ) : null}
              </div>
              <ul className="rec-checklist__items">
                {group.items.map((item) => (
                  <li key={item.key} className="rec-checklist__item">
                    <span className="rec-checklist__mark" data-done={item.done || undefined}>
                      {item.done ? <Icon icon={Check} size={14} /> : null}
                      <span className="sr-only">{item.done ? "Done:" : "To do:"}</span>
                    </span>
                    <span>
                      <span className="body-sm">{item.label}</span>
                      {item.hint ? <span className="caption rec-muted rec-checklist__hint">{item.hint}</span> : null}
                      {!item.done && item.key === "intake.references" && item.href ? (
                        <Link className="caption rec-checklist__hint rec-checklist__item-link" href={item.href}>
                          Open Where to find it
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className="caption rec-muted">Items update as you save each tab. Optional items are not listed.</p>
      </div>
    </aside>
  );
}
