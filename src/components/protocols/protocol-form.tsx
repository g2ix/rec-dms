"use client";

import { useEffect, useRef, useState } from "react";
import { FormRenderer, patchData, readData, type FieldUi } from "@/components/forms/form-renderer";
import { displayInitials } from "@/lib/protocols/format";
import { formatConflict, isConflict, type SaveConflict } from "@/lib/forms/conflict";
import type { RoleKey } from "@/lib/forms/roles";
import type { FormSchema } from "@/lib/forms/schema";
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
  boundValues,
}: {
  instanceId: string;
  schema: FormSchema;
  initialData: Record<string, unknown>;
  initialRevision: number;
  mode: "edit" | "view";
  roles: RoleKey[];
  boundValues: Record<string, unknown>;
}) {
  const [data, setData] = useState(initialData);
  const [ui, setUi] = useState<Record<string, Ui>>({});
  const [viewers, setViewers] = useState<{ id: string; name: string }[]>([]);
  const revision = useRef(initialRevision);
  const pending = useRef(new Map<string, unknown>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const blocked = useRef(new Set<string>());
  const saving = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (mode !== "edit") return;
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
  }, [instanceId, mode]);

  function schedule(path: string, value: unknown) {
    if (mode !== "edit" || blocked.current.has(path)) return;
    pending.current.set(path, value);
    const existing = timers.current.get(path);
    if (existing) clearTimeout(existing);
    timers.current.set(
      path,
      setTimeout(() => {
        timers.current.delete(path);
        void flush(path);
      }, 800),
    );
  }

  async function flush(path: string) {
    if (saving.current || blocked.current.has(path) || !pending.current.has(path)) return;
    const value = pending.current.get(path);
    pending.current.delete(path);
    saving.current = true;
    setUi((current) => ({ ...current, [path]: { state: "saving" } }));
    const result = await saveFieldAction({ instanceId, path, value, expectedRevision: revision.current });
    saving.current = false;
    if (result.ok) {
      revision.current = result.revision;
      setData((current) => {
        let next = current;
        for (const written of result.writtenPaths) {
          if (pending.current.has(written)) continue;
          next = patchData(next, written, readData(result.data, written));
        }
        return next;
      });
      setUi((current) => ({ ...current, [path]: { state: "saved" } }));
    } else if (isConflict(result)) {
      revision.current = result.revision;
      blocked.current.add(path);
      setUi((current) => ({
        ...current,
        [path]: { state: "conflict", message: formatConflict(result), conflict: result },
      }));
    } else {
      setUi((current) => ({ ...current, [path]: { state: "idle", error: result.message } }));
    }
    const nextPath = pending.current.keys().next().value;
    if (nextPath) void flush(nextPath);
  }

  async function keepMine(path: string) {
    const conflict = ui[path]?.conflict;
    if (!conflict) return;
    blocked.current.delete(path);
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
      blocked.current.add(path);
      setUi((current) => ({
        ...current,
        [path]: { state: "conflict", message: formatConflict(result), conflict: result },
      }));
    }
  }

  function useTheirs(path: string) {
    const conflict = ui[path]?.conflict;
    if (!conflict) return;
    blocked.current.delete(path);
    pending.current.delete(path);
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
        stepKey={null}
        boundValues={boundValues}
        fieldState={ui}
        onChange={(path, value) => {
          setData((current) => patchData(current, path, value));
          schedule(path, value);
        }}
        onKeepMine={keepMine}
        onUseTheirs={useTheirs}
      />
    </div>
  );
}
