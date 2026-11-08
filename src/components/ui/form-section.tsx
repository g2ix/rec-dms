"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

export type FormSectionProgress = {
  status: "optional" | "not-started" | "in-progress" | "complete";
  label: string;
  tone: "muted" | "warning" | "complete";
};

export function FormSection({
  id,
  number,
  title,
  description,
  headingId,
  className,
  progress,
  onTouch,
  onLeave,
  children,
}: {
  id?: string;
  number: string | number;
  title: string;
  description: string;
  headingId: string;
  className?: string;
  progress?: FormSectionProgress;
  onTouch?: () => void;
  onLeave?: () => void;
  children: React.ReactNode;
}) {
  const previous = useRef(progress?.status);
  const [pop, setPop] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const status = progress?.status;

  useEffect(() => {
    if (!status) return;
    const before = previous.current;
    previous.current = status;
    if (before && before !== "complete" && status === "complete") {
      setAnnouncement(`${title}, complete`);
      setPop(true);
      const timer = window.setTimeout(() => setPop(false), 240);
      return () => window.clearTimeout(timer);
    }
    if (status !== "complete") {
      setAnnouncement("");
      setPop(false);
    }
  }, [status, title]);

  return (
    <section
      id={id}
      className={cn("form-section", className)}
      aria-labelledby={headingId}
      onFocus={onTouch}
      onBlur={(event) => {
        if (!onLeave) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        onLeave();
      }}
    >
      <div className="form-section__head">
        <span
          className="form-section__step"
          data-status={progress?.status}
          data-pop={pop ? "true" : undefined}
          aria-hidden="true"
        >
          {progress?.status === "complete" ? <Icon icon={Check} size={16} /> : number}
        </span>
        <div className="form-section__titles">
          <h2 id={headingId} className="heading" tabIndex={-1}>
            {title}
          </h2>
          <p className="form-section__description">{description}</p>
        </div>
        {progress?.label ? (
          <p className="form-section__status" data-tone={progress.tone}>
            {progress.label}
          </p>
        ) : null}
        {progress ? (
          <span className="rec-sr" aria-live="polite">
            {announcement}
          </span>
        ) : null}
      </div>
      <div className="form-section__body">{children}</div>
    </section>
  );
}
