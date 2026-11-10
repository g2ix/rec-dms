"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormRenderer, patchData, readData, type FieldUi } from "@/components/forms/form-renderer";
import { Button } from "@/components/ui/button";
import { useAutosaveLifecycle } from "@/hooks/use-autosave-lifecycle";
import {
  createAutosaveQueue,
  keepaliveSavePayload,
  postKeepaliveSave,
  type AutosaveQueue,
  type AutosaveUi,
} from "@/lib/forms/autosave";
import { formatConflict, isConflict, type SaveConflict } from "@/lib/forms/conflict";
import { isRoleKey, ROLE_KEYS, ROLE_KEY_LABEL, type RoleKey } from "@/lib/forms/roles";
import type { FormSchema } from "@/lib/forms/schema";
import { PREVIEW_BOUND_VALUES } from "@/lib/forms/bindings";
import { flushRegisteredAutosaves } from "@/lib/forms/flush-registry";
import {
  markCompleteAction,
  newSandboxAction,
  reopenSandboxAction,
  saveFieldAction,
  setSandboxPreviewAction,
} from "@/server/forms/actions";

type Ui = FieldUi & { conflict?: SaveConflict };

export function SandboxForm({
  definitionId,
  instanceId,
  schema,
  initialData,
  initialRevision,
  initialStatus,
  initialRoles,
  initialStep,
}: {
  definitionId: string;
  instanceId: string;
  schema: FormSchema;
  initialData: Record<string, unknown>;
  initialRevision: number;
  initialStatus: "DRAFT" | "COMPLETE" | "LOCKED";
  initialRoles: RoleKey[];
  initialStep: string | null;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState(initialStatus);
  const [roles, setRoles] = useState<RoleKey[]>(initialRoles.length > 0 ? initialRoles : ["PROPONENT"]);
  const [step, setStep] = useState(initialStep ?? "");
  const [ui, setUi] = useState<Record<string, Ui>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [revisionNumber, setRevisionNumber] = useState(initialRevision);
  const revision = useRef(initialRevision);
  const statusRef = useRef(status);
  statusRef.current = status;
  const dataRef = useRef(data);
  dataRef.current = data;
  const editing = status === "DRAFT";

  function rememberRevision(value: number) {
    revision.current = value;
    setRevisionNumber(value);
  }

  const queue = useMemo<AutosaveQueue | null>(() => {
    if (!editing) return null;
    return createAutosaveQueue({
      enabled: () => statusRef.current === "DRAFT",
      getRevision: () => revision.current,
      save: async ({ path, value, expectedRevision }) =>
        saveFieldAction({ instanceId, path, value, expectedRevision }),
      keepaliveSave: ({ fields, expectedRevision }) => {
        postKeepaliveSave(instanceId, keepaliveSavePayload({ fields, expectedRevision }));
      },
      hooks: {
        onUi: (path, next) => setUi((current) => ({ ...current, [path]: applyUi(next) })),
        onRevision: rememberRevision,
        onWritten: (writtenPaths, nextData, stillPending) => {
          setData((current) => {
            let next = current;
            for (const written of writtenPaths) {
              if (stillPending.has(written)) continue;
              next = patchData(next, written, readData(nextData, written));
            }
            return next;
          });
        },
      },
    });
  }, [editing, instanceId]);

  useEffect(() => () => queue?.dispose(), [queue]);
  useAutosaveLifecycle(queue, editing);

  async function keepMine(path: string) {
    const conflict = ui[path]?.conflict;
    if (!conflict || !queue) return;
    queue.unblock(path);
    setUi((current) => ({ ...current, [path]: { state: "saving" } }));
    const result = await saveFieldAction({
      instanceId,
      path,
      value: readData(dataRef.current, path),
      expectedRevision: revision.current,
    });
    if (result.ok) {
      rememberRevision(result.revision);
      setUi((current) => ({ ...current, [path]: { state: "saved" } }));
      return;
    }
    if (isConflict(result)) {
      rememberRevision(result.revision);
      queue.block(path);
      setUi((current) => ({
        ...current,
        [path]: { state: "conflict", message: formatConflict(result), conflict: result },
      }));
      return;
    }
    setUi((current) => ({ ...current, [path]: { state: "idle", error: result.message } }));
  }

  function useTheirs(path: string) {
    const conflict = ui[path]?.conflict;
    if (!conflict || !queue) return;
    queue.unblock(path);
    queue.dropPending(path);
    setData((current) => patchData(current, path, conflict.value));
    setUi((current) => ({ ...current, [path]: { state: "idle" } }));
  }

  async function applyRole(nextRoles: RoleKey[], nextStep: string) {
    const result = await setSandboxPreviewAction({
      instanceId,
      roles: nextRoles,
      step: nextStep.trim() ? nextStep.trim() : null,
    });
    if (!result.ok) {
      setBanner(result.message);
      return;
    }
    setRoles(result.roles.filter(isRoleKey));
    setStep(result.step ?? "");
    setBanner(null);
  }

  async function complete() {
    setBusy(true);
    await flushRegisteredAutosaves();
    const result = await markCompleteAction(instanceId);
    setBusy(false);
    if (!result.ok) {
      setBanner(result.message);
      setIssues(result.errors ?? []);
      const mapped: Record<string, Ui> = {};
      for (const issue of result.errors ?? []) mapped[issue.path] = { error: issue.message };
      setUi((current) => ({ ...current, ...mapped }));
      return;
    }
    setStatus("COMPLETE");
    setIssues([]);
    setBanner("This copy is complete. The fields are locked. Reopen the sandbox to edit again.");
    router.refresh();
  }

  async function reopen() {
    setBusy(true);
    const result = await reopenSandboxAction(instanceId);
    setBusy(false);
    if (!result.ok) {
      setBanner(result.message);
      return;
    }
    setStatus("DRAFT");
    setBanner(null);
    router.refresh();
  }

  const fieldState: Record<string, FieldUi> = {};
  for (const [path, value] of Object.entries(ui)) {
    fieldState[path] = { state: value.state, message: value.message, error: value.error };
  }

  return (
    <div className="rec-stack">
      <div className="rec-actions">
        <label className="label" htmlFor="sandbox-role">
          Fill as
        </label>
        <select
          id="sandbox-role"
          className="rec-select"
          value={roles[0] ?? "PROPONENT"}
          onChange={(event) => {
            if (!isRoleKey(event.target.value)) return;
            void applyRole([event.target.value], step);
          }}
        >
          {ROLE_KEYS.map((key) => (
            <option key={key} value={key}>
              {ROLE_KEY_LABEL[key]}
            </option>
          ))}
        </select>
        <label className="label" htmlFor="sandbox-step">
          At step
        </label>
        <input
          id="sandbox-step"
          className="rec-input"
          value={step}
          placeholder="Leave empty when every step can edit"
          onChange={(event) => setStep(event.target.value)}
          onBlur={() => void applyRole(roles, step)}
        />
      </div>
      <p className="caption rec-muted">
        Answers save shortly after you stop typing. Open this page in a second window and edit the same field to see a conflict. Revision {revisionNumber}.
      </p>
      {banner ? (
        <p className="rec-banner" role="status">
          {banner}
        </p>
      ) : null}
      {issues.length > 0 ? (
        <ul className="rec-issues caption">
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      <FormRenderer
        schema={schema}
        data={data}
        mode={status === "DRAFT" ? "edit" : "view"}
        roles={roles}
        stepKey={step.trim() ? step.trim() : null}
        boundValues={PREVIEW_BOUND_VALUES}
        fieldState={fieldState}
        onChange={(path, value) => {
          setData((current) => patchData(current, path, value));
          setUi((current) => ({ ...current, [path]: { state: "idle" } }));
          queue?.schedule(path, value);
        }}
        onUseTheirs={useTheirs}
        onKeepMine={(path) => void keepMine(path)}
      />
      <div className="rec-actions">
        {status === "DRAFT" ? (
          <Button type="button" variant="primary" disabled={busy} onClick={() => void complete()}>
            {busy ? "Checking…" : "Mark complete"}
          </Button>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void reopen()}>
            {busy ? "Reopening…" : "Reopen draft"}
          </Button>
        )}
        <form action={newSandboxAction}>
          <input type="hidden" name="id" value={definitionId} />
          <Button type="submit">Start a new sandbox</Button>
        </form>
      </div>
    </div>
  );
}

function applyUi(next: AutosaveUi): Ui {
  return {
    state: next.state,
    message: next.message,
    error: next.error,
    conflict: next.conflict,
  };
}
