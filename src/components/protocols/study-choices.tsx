"use client";

import { useEffect, useId, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { Icon } from "@/components/icons";
import { FUNDING_KINDS, RESEARCH_TYPE_GROUPS, RESEARCH_TYPES } from "@/lib/protocols/catalog";

const TYPES_BY_CODE = new Map(RESEARCH_TYPES.map((type) => [type.code, type]));

function tileText(label: string): { name: string; note?: string } {
  const match = /^(.*)\(([^()]*)\)\s*$/.exec(label);
  if (!match?.[1] || !match[2]) return { name: label };
  return { name: match[1].trim(), note: match[2].trim() };
}

export function ResearchTypeChoices({
  id,
  selected,
  other,
  disabled,
  error,
  otherError,
  onToggle,
  onOther,
  onOtherBlur,
}: {
  id: string;
  selected: readonly string[];
  other: string;
  disabled?: boolean;
  error?: string;
  otherError?: string;
  onToggle: (code: string, checked: boolean) => void;
  onOther: (value: string) => void;
  onOtherBlur?: () => void;
}) {
  const helpId = useId();
  const errorId = useId();
  const otherErrorId = useId();
  const otherRef = useRef<HTMLInputElement>(null);
  const otherWasOn = useRef(selected.includes("OTHER"));
  const chosen = new Set(selected);
  const countLabel = selected.length === 0 ? "None selected" : `${selected.length} selected`;

  useEffect(() => {
    const on = selected.includes("OTHER");
    if (on && !otherWasOn.current) otherRef.current?.focus();
    otherWasOn.current = on;
  }, [selected]);

  return (
    <fieldset className="type-field" aria-describedby={helpId} aria-invalid={error || otherError ? true : undefined}>
      <legend className="rec-field__label">Research type</legend>
      <div className="type-field__meta">
        <p id={helpId} className="caption rec-muted">
          Choose every type that applies.
        </p>
        <p className="caption rec-muted" aria-live="polite">
          {countLabel}
        </p>
      </div>
      {RESEARCH_TYPE_GROUPS.map((group) => {
        const groupId = `${id}-${group.label.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <div className="type-field__group" key={group.label}>
            <p id={groupId} className="type-field__group-label">
              {group.label}
            </p>
            <div className="type-field__grid" role="group" aria-labelledby={groupId}>
              {group.codes.map((code) => {
                const type = TYPES_BY_CODE.get(code);
                if (!type) return null;
                const text = tileText(type.label);
                const checked = chosen.has(code);
                return (
                  <label className="type-tile" key={code}>
                    <input
                      id={code === group.codes[0] && group === RESEARCH_TYPE_GROUPS[0] ? id : `${id}-${code}`}
                      type="checkbox"
                      name="researchTypeCode"
                      value={code}
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) => onToggle(code, event.target.checked)}
                    />
                    <span className="type-tile__text">
                      <span className="type-tile__name">{text.name}</span>
                      {text.note ? <span className="type-tile__note">{text.note}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
      {error ? (
        <p id={errorId} className="rec-field__error" role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{error}</span>
        </p>
      ) : null}
      <div className="type-field__other">
        <label className="type-tile">
          <input
            id={`${id}-others`}
            type="checkbox"
            name="researchTypeCode"
            value="OTHER"
            checked={chosen.has("OTHER")}
            disabled={disabled}
            onChange={(event) => {
              onToggle("OTHER", event.target.checked);
              if (!event.target.checked) onOther("");
            }}
          />
          <span className="type-tile__text">
            <span className="type-tile__name">Others</span>
          </span>
        </label>
        {chosen.has("OTHER") ? (
          <input
            ref={otherRef}
            id={`${id}-other`}
            className="rec-input"
            name="researchTypeOther"
            value={other}
            disabled={disabled}
            placeholder="Please specify"
            aria-label="Other research type, please specify"
            aria-invalid={otherError ? true : undefined}
            aria-describedby={otherError ? otherErrorId : undefined}
            onBlur={onOtherBlur}
            onChange={(event) => onOther(event.target.value)}
          />
        ) : null}
      </div>
      {otherError ? (
        <p id={otherErrorId} className="rec-field__error" role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{otherError}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

export function FundingChoices({
  id,
  selected,
  details,
  disabled,
  error,
  fieldError,
  onToggle,
  onDetail,
  onDetailBlur,
}: {
  id: string;
  selected: readonly string[];
  details: Record<string, string>;
  disabled?: boolean;
  error?: string;
  fieldError?: (code: string) => string | undefined;
  onToggle: (code: string, checked: boolean) => void;
  onDetail: (code: string, value: string) => void;
  onDetailBlur?: (code: string) => void;
}) {
  const helpId = useId();
  const errorId = useId();
  const chosen = new Set(selected);
  const previous = useRef<Set<string> | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = new Set(selected);
    if (!before) return;
    for (const code of selected) {
      if (before.has(code)) continue;
      const kind = FUNDING_KINDS.find((item) => item.code === code);
      if (!kind || kind.detail === "NONE") continue;
      document.getElementById(`${id}-${code}-detail`)?.focus();
      break;
    }
  }, [id, selected]);

  return (
    <fieldset className="fund-field" aria-describedby={helpId} aria-invalid={error ? true : undefined}>
      <legend className="rec-field__label">
        Source of funds
        <span className="rec-field__optional"> (optional)</span>
      </legend>
      <p id={helpId} className="caption rec-muted">
        Choose all that apply. Name the funder where asked; it prints on the REC forms.
      </p>
      <div className="fund-grid">
        {FUNDING_KINDS.map((kind, index) => {
          const checked = chosen.has(kind.code);
          const follow = "prompt" in kind ? kind : null;
          const message = follow && checked ? fieldError?.(kind.code) : undefined;
          const messageId = `${id}-${kind.code}-error`;
          return (
            <div className="fund-tile" key={kind.code}>
              <label className="fund-tile__choice">
                <input
                  id={index === 0 ? id : `${id}-${kind.code}`}
                  type="checkbox"
                  name="fundingCode"
                  value={kind.code}
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onToggle(kind.code, event.target.checked)}
                />
                <span className="fund-tile__name">{kind.label}</span>
              </label>
              {follow && checked ? (
                <div className="fund-tile__follow">
                  <div className="fund-tile__follow-inner">
                    <label className="fund-tile__label" htmlFor={`${id}-${kind.code}-detail`}>
                      {follow.prompt}
                    </label>
                    <input
                      id={`${id}-${kind.code}-detail`}
                      className="rec-input fund-tile__input"
                      name={`fundingDetail_${kind.code}`}
                      value={details[kind.code] ?? ""}
                      disabled={disabled}
                      placeholder={follow.placeholder}
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? messageId : undefined}
                      onBlur={() => onDetailBlur?.(kind.code)}
                      onChange={(event) => onDetail(kind.code, event.target.value)}
                    />
                    {message ? (
                      <p id={messageId} className="rec-field__error" role="alert">
                        <Icon icon={AlertCircle} size={16} />
                        <span>{message}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {error ? (
        <p id={errorId} className="rec-field__error" role="alert">
          <Icon icon={AlertCircle} size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
