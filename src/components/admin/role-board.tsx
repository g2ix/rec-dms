"use client";

import { useActionState, useMemo, useState } from "react";
import { Check, Lock, Minus, Plus } from "lucide-react";
import { Icon } from "@/components/icons";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { formatManila } from "@/lib/time";
import { GROUP_ORDER, GROUP_TITLE, type RoleGroup } from "@/lib/users/role-authority";
import type { RoleCard } from "@/server/users/roles";
import { applyRoleChangesAction } from "@/server/users/actions";

type State = "granted" | "adding" | "removing" | "off" | "replacing";

const STATE_TEXT: Record<State, string> = {
  granted: "Granted",
  adding: "Will be granted",
  removing: "Will be revoked",
  off: "Not granted",
  replacing: "Will be handed over",
};

const GROUP_NOTE: Record<RoleGroup, string> = {
  account: "What the account is for. REC Staff set these.",
  panel: "Appointed per panel by the REC Chair. Chair, Vice-Chair, and Secretary have one holder per panel.",
  committee: "Appointed by the REC Chair.",
  office: "Appointed by the REC Chair.",
  system: "Granted only by a System Admin.",
};

const key = (roleId: string, panelId: string | null) => `${roleId}|${panelId ?? ""}`;

function StateIcon({ state, locked }: { state: State; locked: boolean }) {
  if (locked) return <Icon icon={Lock} size={16} />;
  if (state === "granted") return <Icon icon={Check} size={16} />;
  if (state === "removing") return <Icon icon={Minus} size={16} />;
  if (state === "adding" || state === "replacing") return <Icon icon={Plus} size={16} />;
  return <Icon icon={Plus} size={16} />;
}

export function RoleBoard({ userId, active, cards }: { userId: string; active: boolean; cards: RoleCard[] }) {
  const [adds, setAdds] = useState<Set<string>>(new Set());
  const [removes, setRemoves] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState(applyRoleChangesAction, null);

  const toggleGrant = (grantId: string) =>
    setRemoves((current) => {
      const next = new Set(current);
      if (next.has(grantId)) next.delete(grantId);
      else next.add(grantId);
      return next;
    });
  const toggleAdd = (id: string) =>
    setAdds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handovers = useMemo(
    () =>
      cards.flatMap((card) =>
        (card.panels ?? []).filter((panel) => adds.has(key(card.roleId, panel.panelId)) && panel.heldBy && card.singleHolder).map((panel) => `${panel.heldBy} (${card.name}, ${panel.panelName})`),
      ),
    [adds, cards],
  );
  const reasonNeeded = removes.size > 0 || handovers.length > 0;
  const changeCount = adds.size + removes.size;
  const discard = () => {
    setAdds(new Set());
    setRemoves(new Set());
    setReason("");
  };

  const changes = JSON.stringify({
    add: [...adds].map((item) => {
      const [roleId, panelId] = item.split("|");
      return { roleId, panelId: panelId || null };
    }),
    remove: [...removes],
  });

  const stateOf = (grantId: string | null, addKey: string, heldBy: string | null): State => {
    if (grantId) return removes.has(grantId) ? "removing" : "granted";
    if (adds.has(addKey)) return heldBy ? "replacing" : "adding";
    return "off";
  };

  const groups = GROUP_ORDER.map((group) => ({ group, cards: cards.filter((card) => card.group === group) })).filter((item) => item.cards.length > 0);

  return (
    <form action={action} className="rec-stack rec-role-board">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="changes" value={changes} />

      <div className="rec-role-legend" aria-label="What the colours mean">
        <span className="rec-role-legend__item" data-state="granted">
          Granted
        </span>
        <span className="rec-role-legend__item" data-state="adding">
          Will be granted
        </span>
        <span className="rec-role-legend__item" data-state="removing">
          Will be revoked
        </span>
        <span className="rec-role-legend__item" data-state="off">
          Not granted
        </span>
        <span className="rec-role-legend__item" data-state="locked">
          Not yours to change
        </span>
      </div>

      {!active ? <p className="rec-alert">Only an active account can be given roles. Approve the account first.</p> : null}

      {groups.map(({ group, cards: list }) => (
        <section key={group} className="rec-stack" aria-labelledby={`group-${group}`}>
          <div>
            <h2 className="heading" id={`group-${group}`}>
              {GROUP_TITLE[group]}
            </h2>
            <p className="body-sm rec-muted">{GROUP_NOTE[group]}</p>
          </div>
          <div className={group === "panel" ? "rec-role-grid rec-role-grid--wide" : "rec-role-grid"}>
            {list.map((card) => {
              const locked = !card.canChange || !active;
              if (card.panels) {
                return (
                  <div key={card.roleId} className="rec-role-card rec-role-card--panel" data-locked={locked || undefined}>
                    <div className="rec-role-card__top">
                      <span className="subheading">{card.name}</span>
                      {locked ? <Icon icon={Lock} size={16} /> : null}
                    </div>
                    <p className="body-sm rec-muted">{card.blurb}</p>
                    <div className="rec-panel-chips" role="group" aria-label={`${card.name} by panel`}>
                      {card.panels.length === 0 ? <span className="body-sm rec-muted">No active panels.</span> : null}
                      {card.panels.map((panel) => {
                        const addKey = key(card.roleId, panel.panelId);
                        const holder = card.singleHolder ? panel.heldBy : null;
                        const chipState = stateOf(panel.grantId, addKey, holder);
                        return (
                          <button
                            key={panel.panelId}
                            type="button"
                            className="rec-panel-chip"
                            data-state={chipState}
                            aria-pressed={chipState === "granted" || chipState === "adding" || chipState === "replacing"}
                            disabled={locked}
                            onClick={() => (panel.grantId ? toggleGrant(panel.grantId) : toggleAdd(addKey))}
                            title={locked ? (card.lockedNote ?? undefined) : undefined}
                          >
                            <StateIcon state={chipState} locked={locked} />
                            <span>
                              <span className="rec-panel-chip__name" title={panel.panelName}>
                                {panel.panelName.split(" — ")[0]}
                                {panel.panelName.includes(" — ") ? (
                                  <span className="rec-panel-chip__scope">{panel.panelName.split(" — ").slice(1).join(" — ")}</span>
                                ) : null}
                              </span>
                              <span className="caption">
                                {chipState === "off" && holder
                                  ? `Now: ${holder}`
                                  : chipState === "replacing"
                                    ? `Replaces ${holder}`
                                    : STATE_TEXT[chipState]}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {locked && card.lockedNote ? <p className="caption rec-muted">{card.lockedNote}</p> : null}
                  </div>
                );
              }
              const addKey = key(card.roleId, null);
              const cardState = stateOf(card.grantId, addKey, null);
              return (
                <button
                  key={card.roleId}
                  type="button"
                  className="rec-role-card"
                  data-state={cardState}
                  data-locked={locked || undefined}
                  aria-pressed={cardState === "granted" || cardState === "adding"}
                  disabled={locked}
                  onClick={() => (card.grantId ? toggleGrant(card.grantId) : toggleAdd(addKey))}
                >
                  <span className="rec-role-card__top">
                    <span className="subheading">{card.name}</span>
                    <span className="rec-role-card__state">
                      <StateIcon state={cardState} locked={locked} />
                      {STATE_TEXT[cardState]}
                    </span>
                  </span>
                  <span className="body-sm rec-muted">{card.blurb}</span>
                  {cardState === "granted" && card.granted ? (
                    <span className="caption rec-muted">
                      Since {formatManila(new Date(card.granted.at), "d MMM yyyy")}
                      {card.granted.by ? ` · by ${card.granted.by}` : ""}
                    </span>
                  ) : null}
                  {locked && card.lockedNote && active ? <span className="caption rec-muted">{card.lockedNote}</span> : null}
                  {!locked ? (
                    <span className="rec-role-card__hint caption">
                      {cardState === "granted" ? "Click to revoke" : cardState === "off" ? "Click to grant" : "Click to undo"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      {changeCount > 0 ? (
        <div className="rec-savebar" role="region" aria-label="Unsaved role changes">
          <div className="rec-savebar__summary">
            <strong>
              {[adds.size ? `${adds.size} to grant` : "", removes.size ? `${removes.size} to revoke` : ""].filter(Boolean).join(", ")}
            </strong>
            {handovers.length > 0 ? <span className="body-sm">Hands over from {handovers.join("; ")}.</span> : null}
          </div>
          {reasonNeeded ? (
            <label className="rec-savebar__reason">
              <span className="label">Reason (kept in the audit log)</span>
              <input className="rec-input" name="reason" required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : (
            <input type="hidden" name="reason" value="" />
          )}
          {state?.error ? (
            <p className="rec-alert" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="rec-actions">
            <Button type="button" variant="secondary" onClick={discard}>
              Discard
            </Button>
            <BusyButton type="submit" variant="primary" busy={pending} busyLabel="Saving…">
              Save {changeCount === 1 ? "change" : `${changeCount} changes`}
            </BusyButton>
          </div>
        </div>
      ) : null}
    </form>
  );
}
