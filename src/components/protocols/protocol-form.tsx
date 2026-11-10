"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormRenderer, patchData, readData, type FieldUi } from "@/components/forms/form-renderer";
import { useAutosaveLifecycle } from "@/hooks/use-autosave-lifecycle";
import { displayInitials } from "@/lib/protocols/format";
import {
  createAutosaveQueue,
  keepaliveSavePayload,
  postKeepaliveSave,
  type AutosaveQueue,
  type AutosaveUi,
} from "@/lib/forms/autosave";
import { formatConflict, isConflict, type SaveConflict } from "@/lib/forms/conflict";
import type { RoleKey } from "@/lib/forms/roles";
import type { FormSchema } from "@/lib/forms/schema";
import type { SignatureSlotView, SigningPrompt } from "@/lib/signatures/view";
import { saveFieldAction } from "@/server/forms/actions";
import { presenceAction } from "@/server/protocols/actions";

type Ui = FieldUi & { conflict?: SaveConflict };

export function ProtocolForm({
  instanceId,
  schema,
  initialData,
  initialRevision,
  mode,
  roles,
  stepKey = null,
  allowedRows,
  boundValues,
  signatureSlots,
  signing = null,
}: {
  instanceId: string;
  schema: FormSchema;
  initialData: Record<string, unknown>;
  initialRevision: number;
  mode: "edit" | "view";
  roles: RoleKey[];
  stepKey?: string | null;
  allowedRows?: Record<string, readonly string[]>;
  boundValues: Record<string, unknown>;
  signatureSlots?: Record<string, SignatureSlotView[]>;
  signing?: SigningPrompt | null;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [ui, setUi] = useState<Record<string, Ui>>({});
  const [viewers, setViewers] = useState<{ id: string; name: string }[]>([]);
  const revision = useRef(initialRevision);
  const dataRef = useRef(data);
  dataRef.current = data;
  const editing = mode === "edit";

  const queue = useMemo<AutosaveQueue | null>(() => {
    if (!editing) return null;
    return createAutosaveQueue({
      getRevision: () => revision.current,
      save: async ({ path, value, expectedRevision }) =>
        saveFieldAction({ instanceId, path, value, expectedRevision }),
      keepaliveSave: ({ fields, expectedRevision }) => {
        postKeepaliveSave(instanceId, keepaliveSavePayload({ fields, expectedRevision }));
      },
      hooks: {
        onUi: (path, next) => setUi((current) => ({ ...current, [path]: applyUi(next) })),
        onRevision: (next) => {
          revision.current = next;
        },
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
        onSignaturesVoided: () => router.refresh(),
      },
    });
  }, [editing, instanceId, router]);

  useEffect(() => () => queue?.dispose(), [queue]);
  useAutosaveLifecycle(queue, editing);

  useEffect(() => {
    if (!editing) return;
    let stop = false;
    async function beat() {
      if (stop) return;
      const result = await presenceAction(instanceId);
      if (result.ok) setViewers(result.viewers);
    }
    void beat();
    const timer = setInterval(() => void beat(), 15_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [instanceId, editing]);

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
      revision.current = result.revision;
      setUi((current) => ({ ...current, [path]: { state: "saved" } }));
      return;
    }
    if (isConflict(result)) {
      revision.current = result.revision;
      queue.block(path);
      setUi((current) => ({
        ...current,
        [path]: { state: "conflict", message: formatConflict(result), conflict: result },
      }));
    }
  }

  function useTheirs(path: string) {
    const conflict = ui[path]?.conflict;
    if (!conflict || !queue) return;
    queue.unblock(path);
    queue.dropPending(path);
    setData((current) => patchData(current, path, conflict.value));
    setUi((current) => ({ ...current, [path]: { state: "saved" } }));
  }

  return (
    <div className="rec-stack">
      <div className="rec-avatar-row" aria-live="polite">
        <p className="body-sm rec-muted">{viewers.length === 0 ? "No one else is on this form." : "Also on this form"}</p>
        {viewers.map((viewer) => (
          <span key={viewer.id} className="rec-avatar" title={viewer.name} aria-label={viewer.name}>
            {displayInitials(viewer.name)}
          </span>
        ))}
      </div>
      <FormRenderer
        schema={schema}
        data={data}
        mode={mode}
        roles={roles}
        stepKey={stepKey}
        allowedRows={allowedRows}
        boundValues={boundValues}
        fieldState={ui}
        onChange={(path, value) => {
          setData((current) => patchData(current, path, value));
          queue?.schedule(path, value);
        }}
        onKeepMine={keepMine}
        onUseTheirs={useTheirs}
        signatureSlots={signatureSlots}
        signing={signing}
      />
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
