"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addReturnNoteAction, removeReturnNoteAction } from "@/server/revision/actions";

type Anchor = { key: string; label: string };
type Draft = { id: string; anchor: string; anchorLabel: string; body: string };

/**
 * Comments the adviser, REC Staff or the chair pin to a section or upload before returning. They
 * stay drafts, seen only by their author, until the task is completed with a return outcome; any
 * other outcome discards them. The proponents then see each one on its section with a red "!".
 */
export function ReturnNotes({ protocolId, anchors, drafts }: { protocolId: string; anchors: Anchor[]; drafts: Draft[] }) {
  const router = useRouter();
  const [anchor, setAnchor] = useState(anchors[0]?.key ?? "general");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setError(null);
    start(async () => {
      const result = await addReturnNoteAction({ protocolId, anchor, body });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  function remove(noteId: string) {
    setError(null);
    start(async () => {
      const result = await removeReturnNoteAction({ protocolId, noteId });
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  }

  return (
    <section className="rec-card rec-stack" aria-labelledby="return-notes-heading" data-testid="return-notes">
      <h3 id="return-notes-heading" className="subheading">
        Comments for the proponents
      </h3>
      <p className="body-sm rec-muted">
        Pin each change to the section or file it is about. They are sent only if you choose a return outcome below; otherwise they are discarded.
      </p>
      {drafts.length > 0 ? (
        <ul className="rec-stack" aria-label="Comments to send">
          {drafts.map((draft) => (
            <li key={draft.id} className="rec-note-row">
              <div className="rec-stack">
                <span className="label">{draft.anchorLabel}</span>
                <p className="body-sm">{draft.body}</p>
              </div>
              <Button type="button" variant="ghost" onClick={() => remove(draft.id)} disabled={pending} aria-label={`Remove the comment on ${draft.anchorLabel}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="rec-field">
        <span className="label">About</span>
        <select className="rec-select" value={anchor} onChange={(event) => setAnchor(event.target.value)}>
          {anchors.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="rec-field rec-field--wide">
        <span className="label">Comment</span>
        <textarea className="rec-input" rows={3} value={body} onChange={(event) => setBody(event.target.value)} maxLength={4000} />
      </label>
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <div className="rec-actions">
        <Button type="button" variant="secondary" onClick={add} disabled={pending || body.trim().length === 0}>
          {pending ? "Adding…" : "Add comment"}
        </Button>
      </div>
    </section>
  );
}
