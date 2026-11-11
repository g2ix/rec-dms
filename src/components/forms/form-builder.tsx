"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FormRenderer, patchData } from "@/components/forms/form-renderer";
import { BusyButton } from "@/components/ui/busy-button";
import { Button } from "@/components/ui/button";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import { getEditableFields } from "@/lib/forms/editable";
import { ROLE_KEYS, ROLE_KEY_LABEL, isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { saveDefinitionAction, publishFormAction, retireFormAction, createVersionAction } from "@/server/forms/actions";
import { BlurLoad } from "@/components/ui/blur-load";

const SchemaEditor = dynamic(() => import("@/components/forms/schema-editor").then((mod) => mod.SchemaEditor), {
  ssr: false,
  loading: () => (
    <BlurLoad state="loading" placeholder={<span className="rec-bar rec-bar--lg" />}>
      {null}
    </BlurLoad>
  ),
});

export function FormBuilder({
  id,
  code,
  title,
  version,
  effectiveDate,
  status,
  schema,
  schemaText,
  error,
}: {
  id: string;
  code: string;
  title: string;
  version: string;
  effectiveDate: string;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  schema: FormSchema;
  schemaText: string;
  error?: string;
}) {
  const router = useRouter();
  const locked = status !== "DRAFT";
  const [meta, setMeta] = useState({ code, title, version, effectiveDate });
  const [text, setText] = useState(schemaText);
  const [preview, setPreview] = useState<FormSchema>(schema);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [role, setRole] = useState<RoleKey>("PROPONENT");
  const [step, setStep] = useState("");
  const [message, setMessage] = useState<string | null>(error ?? null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const check = useMemo(() => {
    try {
      return validateSchema(JSON.parse(text) as unknown);
    } catch {
      return { ok: false as const, schema: null, issues: [{ path: "(json)", message: "The schema is not valid JSON." }] };
    }
  }, [text]);

  function onSchema(next: string) {
    setText(next);
    setSaved(false);
    try {
      const parsed = validateSchema(JSON.parse(next) as unknown);
      if (parsed.schema) setPreview(parsed.schema);
    } catch {
      /* Keep the last schema the preview could draw. */
    }
  }

  const editableRole = isRoleKey(role) ? role : "PROPONENT";
  const stepKey = step.trim() ? step.trim() : null;
  const paths = getEditableFields({ schema: preview }, { status: "DRAFT", data }, { id: "preview" }, [editableRole], stepKey);

  async function saveDraft(): Promise<boolean> {
    setPending(true);
    setMessage(null);
    const result = await saveDefinitionAction({ id, ...meta, schemaText: text });
    setPending(false);
    if (!result.ok) {
      setSaved(false);
      setMessage(result.message);
      return false;
    }
    setSaved(true);
    router.refresh();
    return true;
  }

  async function publish() {
    const stored = await saveDraft();
    if (!stored) return;
    const body = new FormData();
    body.set("id", id);
    if (effectiveFrom) body.set("effectiveFrom", effectiveFrom);
    await publishFormAction(body);
  }

  return (
    <div className="rec-stack">
      {status === "PUBLISHED" ? (
        <p className="rec-banner" role="status">
          This version is published. The schema is locked. Create a new version to change it.
        </p>
      ) : null}
      {status === "RETIRED" ? (
        <p className="rec-banner" role="status">
          This version is retired. Create a new version to use the schema again.
        </p>
      ) : null}
      {message ? (
        <p className="rec-alert" role="alert">
          {message}
        </p>
      ) : null}
      <div className="rec-builder">
        <div className="rec-stack">
          <div className="rec-form">
            <label className="label" htmlFor="form-code">
              Code
            </label>
            <input id="form-code" className="rec-input" value={meta.code} readOnly={locked} onChange={(event) => setMeta({ ...meta, code: event.target.value })} />
            <label className="label" htmlFor="form-title">
              Title
            </label>
            <input id="form-title" className="rec-input" value={meta.title} readOnly={locked} onChange={(event) => setMeta({ ...meta, title: event.target.value })} />
            <label className="label" htmlFor="form-version">
              Version
            </label>
            <input
              id="form-version"
              className="rec-input"
              value={meta.version}
              readOnly={locked}
              onChange={(event) => setMeta({ ...meta, version: event.target.value })}
            />
            <label className="label" htmlFor="form-effective">
              Effective date
            </label>
            <input
              id="form-effective"
              className="rec-input"
              type="date"
              value={meta.effectiveDate}
              readOnly={locked}
              onChange={(event) => setMeta({ ...meta, effectiveDate: event.target.value })}
            />
          </div>
          <SchemaEditor value={text} onChange={onSchema} readOnly={locked} />
          {check.issues.length > 0 ? (
            <ul className="rec-issues caption">
              {check.issues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  {issue.path}: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <p className="caption rec-muted">The schema is valid.</p>
          )}
          {locked ? null : (
            <BusyButton variant="primary" busy={pending} busyLabel="Saving…" disabled={!check.ok} onClick={() => void saveDraft()}>
              {saved ? "Saved" : "Save draft"}
            </BusyButton>
          )}
          <div className="rec-actions">
            {status === "DRAFT" ? (
              <label className="rec-field">
                <span className="label">Starts for new protocols on (optional)</span>
                <input className="rec-input" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
                <span className="rec-field__help">Leave empty to use it at once. Protocols created before the date keep the current version.</span>
              </label>
            ) : null}
            {status === "DRAFT" ? (
              <Button type="button" variant="primary" disabled={!check.ok || pending} onClick={() => void publish()}>
                {effectiveFrom ? "Publish, scheduled" : "Publish"}
              </Button>
            ) : null}
            {status !== "RETIRED" ? (
              <form action={retireFormAction}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit">Retire</Button>
              </form>
            ) : null}
          </div>
          <form action={createVersionAction} className="rec-form">
            <input type="hidden" name="id" value={id} />
            <label className="label" htmlFor="new-version">
              New version
            </label>
            <input id="new-version" name="version" className="rec-input" placeholder="02-00" required />
            <p className="caption rec-muted">Copies this schema into a new draft. Published versions stay as they are.</p>
            <Button type="submit">Create version</Button>
          </form>
        </div>
        <div className="rec-stack">
          <div className="rec-actions">
            <label className="label" htmlFor="preview-role">
              Preview as
            </label>
            <select
              id="preview-role"
              className="rec-select"
              value={role}
              onChange={(event) => {
                if (isRoleKey(event.target.value)) setRole(event.target.value);
              }}
            >
              {ROLE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {ROLE_KEY_LABEL[key]}
                </option>
              ))}
            </select>
            <label className="label" htmlFor="preview-step">
              At step
            </label>
            <input
              id="preview-step"
              className="rec-input"
              value={step}
              placeholder="Leave empty when every step can edit"
              onChange={(event) => setStep(event.target.value)}
            />
          </div>
          <p className="caption rec-muted">
            Preview only. {paths.size} field {paths.size === 1 ? "path is" : "paths are"} editable for {ROLE_KEY_LABEL[editableRole]}
            {stepKey ? ` at ${stepKey}` : ""}. Open the sandbox to save answers.
          </p>
          <FormRenderer
            schema={preview}
            data={data}
            mode="edit"
            roles={[editableRole]}
            stepKey={stepKey}
            boundValues={PREVIEW_BOUND_VALUES}
            onChange={(path, value) => setData((current) => patchData(current, path, value))}
          />
        </div>
      </div>
    </div>
  );
}
