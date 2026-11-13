"use client";

import { useRef, useState } from "react";
import { Eye, FileText, Printer } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { PdfDownload } from "@/components/docs/pdf-download";
import { FormRenderer } from "@/components/forms/form-renderer";
import { Icon } from "@/components/icons";
import { goToSection } from "@/components/protocols/intake/rail";
import { Button } from "@/components/ui/button";
import { BlurLoad } from "@/components/ui/blur-load";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PlaceholderBar } from "@/components/ui/placeholder-bar";
import type { FormSchema } from "@/lib/forms/schema";
import type { RoleKey } from "@/lib/forms/roles";
import { railSectionOfBinding } from "@/lib/intake/rail";
import { formPreviewAction } from "@/server/intake/actions";

/** A row of the list. The form itself (schema, values) loads when the proponent opens the preview. */
export type PreviewForm = { instanceId: string; code: string; title: string };

type LoadedForm = PreviewForm & {
  schema: FormSchema;
  data: Record<string, unknown>;
  roles: RoleKey[];
  boundValues: Record<string, unknown>;
};

/**
 * One row per form the intake generates: Preview (a read-only page drawn like the form, each
 * filled-in value linking back to its section of the Intake page), Print, Word and PDF.
 * `linkBack` is false on the Forms tab, where the values link to the Intake tab instead.
 */
export function FormsPreview({ protocolId, forms, linkBack = true }: { protocolId: string; forms: PreviewForm[]; linkBack?: boolean }) {
  const [open, setOpen] = useState<PreviewForm | null>(null);
  const [loaded, setLoaded] = useState<LoadedForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Set when a value link closes the preview: focus then goes to that section, not back to Preview.
  const jumping = useRef<string | null>(null);
  const reduced = Boolean(useReducedMotion());
  const intakeHref = `/app/protocols/${protocolId}/intake`;

  async function show(form: PreviewForm) {
    setOpen(form);
    setLoaded(null);
    setError(null);
    try {
      const result = await formPreviewAction({ protocolId, instanceId: form.instanceId });
      if (result.ok) setLoaded(result.form);
      else setError(result.message);
    } catch {
      setError("The preview could not be opened. Check your connection and try again.");
    }
  }

  function onPreviewClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!linkBack) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.rec-bound-link");
    const hash = link?.getAttribute("href")?.split("#")[1];
    if (!link || !hash) return;
    event.preventDefault();
    jumping.current = hash;
    setOpen(null);
  }

  if (forms.length === 0) return <p className="body-sm">The forms appear here once this version has them.</p>;

  return (
    <>
      <ul className="rec-preview-rows">
        {forms.map((form) => (
          <li key={form.instanceId} className="rec-preview-row" data-testid={`preview-row-${form.code}`}>
            <div className="rec-preview-row__name">
              <span className="code">{form.code}</span>
              <span className="body-sm">{form.title}</span>
            </div>
            <div className="rec-preview-row__actions">
              <Button
                type="button"
                variant="secondary"
                aria-label={`Preview ${form.code}`}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  void show(form);
                }}
              >
                <Icon icon={Eye} size={16} />
                Preview
              </Button>
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
      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogContent
          title={open ? `${open.code} · ${open.title}` : undefined}
          className="rec-dialog--sheet"
          finalFocus={() => {
            const target = jumping.current;
            if (!target) return opener.current;
            jumping.current = null;
            goToSection(target, reduced);
            return false;
          }}
        >
          {open ? (
            <div className="rec-stack" onClick={onPreviewClick} data-testid="form-preview">
              <p className="body-sm rec-muted">
                Read-only. This is how the form prints from your intake.{linkBack ? " Select a value to go to where you answer it." : ""}
              </p>
              {error ? (
                <p className="rec-alert" role="alert">
                  {error}
                </p>
              ) : (
                <BlurLoad
                  state={loaded && loaded.instanceId === open.instanceId ? "ready" : "loading"}
                  placeholder={
                    <div className="rec-stack">
                      <PlaceholderBar width="45%" />
                      <PlaceholderBar />
                      <PlaceholderBar width="80%" />
                      <PlaceholderBar width="60%" />
                    </div>
                  }
                >
                  {loaded && loaded.instanceId === open.instanceId ? (
                    <FormRenderer
                      schema={loaded.schema}
                      data={loaded.data}
                      mode="view"
                      roles={loaded.roles}
                      stepKey={null}
                      boundValues={loaded.boundValues}
                      boundHref={(bind) => {
                        const section = railSectionOfBinding(bind);
                        if (!section) return null;
                        return linkBack ? `#${section}` : `${intakeHref}#${section}`;
                      }}
                    />
                  ) : null}
                </BlurLoad>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
