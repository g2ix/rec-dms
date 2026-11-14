"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Printer } from "lucide-react";
import { OpenDocumentHref } from "@/components/docs/document-open";
import { PdfDownload } from "@/components/docs/pdf-download";
import { Icon } from "@/components/icons";
import { DocumentRow, type FileRow } from "@/components/protocols/intake/documents-section";
import { goToSection } from "@/components/protocols/intake/rail";
import { BusyButton } from "@/components/ui/busy-button";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { startRevisionAction } from "@/server/protocols/actions";
import { answerReturnNoteAction } from "@/server/revision/actions";

export type ReturnedRow = { code: string; label: string; comments: string; remarks: string; earlierAction: string };
export type ReturnedNote = { id: string; anchorLabel: string; section: string | null; roleLabel: string; body: string; done: boolean; reply: string };

/** What the server sends: dates already worded, no person's name anywhere. */
export type ReturnedData = {
  roleLabel: string;
  versionNumber: number;
  returnedOn: string | null;
  dueOn: string | null;
  next: "ADVISER" | "REC" | null;
  started: boolean;
  canStart: boolean;
  editable: boolean;
  released: { instanceId: string; code: string; title: string }[];
  panelRows: ReturnedRow[];
  notes: ReturnedNote[];
  comment: string | null;
  manuscript: { required: boolean; file: FileRow | null; suggestedName: string | null };
  uploads: FileRow[];
};

/**
 * INTAKE-04: the first step of the Intake tab on a returned protocol. What happened (banner), the
 * forms REC released, one row per thing to fix, the revised manuscript, and the other uploads.
 * The intake sections and "Agree and sign" follow in the rail as usual.
 */
export function ReturnedView({
  protocolId,
  data,
  actions,
  onAction,
  status,
  maxBytes,
}: {
  protocolId: string;
  data: ReturnedData;
  /** intake.actions: the Actions taken box of each panel row. */
  actions: Record<string, string>;
  onAction: ((code: string, value: string) => void) | null;
  status?: React.ReactNode;
  maxBytes: number;
}) {
  const nextLabel = data.next === "ADVISER" ? "goes to your adviser" : data.next === "REC" ? "goes to REC" : null;
  const rows = data.panelRows.length + data.notes.length + (data.comment ? 1 : 0);
  return (
    <div className="rec-stack" data-testid="returned-view">
      <section className="rec-returned-banner" aria-labelledby="returned-heading">
        <h3 id="returned-heading" className="heading">
          Returned for revision · version {data.versionNumber}
        </h3>
        <p className="body-sm">
          Returned by the <strong>{data.roleLabel}</strong>
          {data.returnedOn ? ` on ${data.returnedOn}` : ""}.{data.dueOn ? ` Resubmit by ${data.dueOn}.` : ""}
        </p>
        {nextLabel ? <p className="body-sm">When you resubmit, it {nextLabel}.</p> : null}
        {!data.started ? (
          data.canStart ? (
            <form action={startRevisionAction} className="rec-actions">
              <input type="hidden" name="protocolId" value={protocolId} />
              <BusyButton type="submit" variant="primary">
                Start version {data.versionNumber}
              </BusyButton>
              <span className="caption rec-muted">Your answers and files carry over. The rows below open once you start.</span>
            </form>
          ) : (
            <p className="caption rec-muted">The project leader starts version {data.versionNumber}. The rows below open then.</p>
          )
        ) : null}
      </section>

      {data.released.length > 0 ? (
        <section className="rec-stack" aria-labelledby="released-heading">
          <h3 id="released-heading" className="subheading">
            Released documents
          </h3>
          <ul className="rec-preview-rows">
            {data.released.map((form) => (
              <li key={form.instanceId} className="rec-preview-row" data-testid={`released-${form.code}`}>
                <div className="rec-preview-row__name">
                  <span className="code">{form.code}</span>
                  <span className="body-sm">{form.title}</span>
                </div>
                <div className="rec-preview-row__actions">
                  <OpenDocumentHref
                    href={`/api/forms/${form.instanceId}/document?format=pdf&disposition=inline`}
                    label="Preview"
                    inline
                    protocolCode={null}
                    mime="application/pdf"
                    fileName={`${form.code}.pdf`}
                  />
                  <a className="rec-btn rec-btn--secondary" href={`/api/forms/${form.instanceId}/document?format=pdf&disposition=inline`} target="_blank" rel="noopener">
                    <Icon icon={Printer} size={16} />
                    <span>Print</span>
                  </a>
                  <a className="rec-btn rec-btn--secondary" href={`/api/forms/${form.instanceId}/document?format=docx`}>
                    <Icon icon={FileText} size={16} />
                    <span>DOCX</span>
                  </a>
                  <PdfDownload href={`/api/forms/${form.instanceId}/document?format=pdf`} label="PDF" />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rec-stack" aria-labelledby="fix-heading">
        <h3 id="fix-heading" className="subheading">
          What to fix <span className="caption rec-muted">({rows === 1 ? "1 item" : `${rows} items`})</span>
        </h3>
        {rows === 0 ? <p className="body-sm">Nothing was flagged. Check the released documents, then sign and resubmit.</p> : null}
        <ol className="rec-fix-rows">
          {data.comment ? (
            <li className="rec-fix-row" data-testid="fix-comment">
              <p className="label">
                <span className="rec-flag" aria-hidden="true">
                  !
                </span>{" "}
                {data.roleLabel} · General
              </p>
              <p className="body-sm rec-pre-wrap">{data.comment}</p>
            </li>
          ) : null}
          {data.panelRows.map((row) => (
            <li key={row.code} className="rec-fix-row" data-testid={`fix-row-${row.code}`}>
              <p className="label">
                <span className="code">{row.code}</span> {row.label}
              </p>
              {row.comments ? (
                <p className="body-sm rec-pre-wrap">
                  <span className="label">Panel&apos;s comments and recommendations: </span>
                  {row.comments}
                </p>
              ) : null}
              {row.remarks ? (
                <p className="body-sm rec-pre-wrap">
                  <span className="label">Panel&apos;s remarks on your last actions: </span>
                  {row.remarks}
                </p>
              ) : null}
              {row.earlierAction ? (
                <p className="body-sm rec-pre-wrap rec-muted" data-testid={`earlier-${row.code}`}>
                  <span className="label">Your action in version {data.versionNumber - 1}: </span>
                  {row.earlierAction}
                </p>
              ) : null}
              {data.started ? (
                <div className="rec-field rec-field--wide">
                  <label className="rec-field__label" htmlFor={`action-${row.code}`}>
                    Actions taken (page and paragraph)
                  </label>
                  <Textarea
                    id={`action-${row.code}`}
                    value={actions[row.code] ?? ""}
                    disabled={!onAction}
                    onChange={(event) => onAction?.(row.code, event.target.value)}
                  />
                </div>
              ) : null}
            </li>
          ))}
          {data.notes.map((note) => (
            <NoteRow key={note.id} protocolId={protocolId} note={note} editable={data.started && data.editable} />
          ))}
        </ol>
        {data.panelRows.length > 0 && data.started ? status : null}
      </section>

      {data.started && (data.manuscript.required || data.manuscript.file) ? (
        <section className="rec-stack" aria-labelledby="manuscript-heading">
          <h3 id="manuscript-heading" className="subheading">
            Revised manuscript
          </h3>
          <p className="body-sm rec-muted">
            Highlight your changes in it.{data.manuscript.suggestedName ? ` Its file name will be ${data.manuscript.suggestedName}.` : ""} PDF only, up to {Math.round(maxBytes / (1024 * 1024))} MB.
          </p>
          <ul className="rec-doc-rows">
            <DocumentRow protocolId={protocolId} kind="MANUSCRIPT" label="Manuscript" file={data.manuscript.file} canUpload={data.editable} onMessage={() => undefined} />
          </ul>
        </section>
      ) : null}

      {data.started && data.uploads.length > 0 ? (
        <section className="rec-stack" aria-labelledby="carried-heading">
          <h3 id="carried-heading" className="subheading">
            Other files
          </h3>
          <p className="body-sm rec-muted">Carried over from the last version. Replace one if you changed it.</p>
          <ul className="rec-doc-rows">
            {data.uploads.map((file) => (
              <DocumentRow
                key={file.id}
                protocolId={protocolId}
                kind={file.kind}
                label={file.kind === "COVER_LETTER" ? "Cover letter" : "Supporting file"}
                file={file}
                canUpload={data.editable && file.kind !== "SUPPORTING"}
                onMessage={() => undefined}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function NoteRow({ protocolId, note, editable }: { protocolId: string; note: ReturnedNote; editable: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState(note.done);
  const [reply, setReply] = useState(note.reply);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(nextDone: boolean, nextReply: string) {
    setError(null);
    start(async () => {
      const result = await answerReturnNoteAction({ protocolId, noteId: note.id, done: nextDone, reply: nextReply });
      if (!result.ok) {
        setError(result.message);
        setDone(note.done);
        return;
      }
      router.refresh();
    });
  }

  return (
    <li className="rec-fix-row" data-testid="fix-note" data-done={done || undefined}>
      <p className="label">
        <span className="rec-flag" aria-hidden="true">
          !
        </span>{" "}
        {note.roleLabel} ·{" "}
        {note.section ? (
          <a
            href={`#${note.section}`}
            onClick={(event) => {
              event.preventDefault();
              goToSection(note.section!);
            }}
          >
            {note.anchorLabel}
          </a>
        ) : (
          note.anchorLabel
        )}
        {done ? <StatusBadge tone="success" label="Done" /> : null}
      </p>
      <p className="body-sm rec-pre-wrap">{note.body}</p>
      <Checkbox
        label="Done"
        checked={done}
        disabled={!editable || pending}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setDone(next);
          save(next, reply);
        }}
      />
      <div className="rec-field rec-field--wide">
        <label className="rec-field__label" htmlFor={`reply-${note.id}`}>
          Reply (optional)
        </label>
        <Textarea
          id={`reply-${note.id}`}
          value={reply}
          disabled={!editable}
          onChange={(event) => setReply(event.target.value)}
          onBlur={() => {
            if (reply !== note.reply) save(done, reply);
          }}
        />
      </div>
      {error ? (
        <p className="rec-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
