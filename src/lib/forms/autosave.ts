import { formatConflict, isConflict, type SaveConflict } from "@/lib/forms/conflict";

export type AutosaveSuccess = {
  ok: true;
  revision: number;
  data: Record<string, unknown>;
  writtenPaths: string[];
  signaturesVoided?: boolean;
};

export type AutosaveFailure = { ok: false; code: string; message: string };

export type AutosaveResult = AutosaveSuccess | SaveConflict | AutosaveFailure;

export type AutosaveSave = (input: {
  path: string;
  value: unknown;
  expectedRevision: number;
}) => Promise<AutosaveResult>;

export type AutosaveUiState = "saving" | "saved" | "idle" | "conflict";

export type AutosaveUi = {
  state: AutosaveUiState;
  message?: string;
  error?: string;
  conflict?: SaveConflict;
};

export type AutosaveHooks = {
  onUi?: (path: string, ui: AutosaveUi) => void;
  onRevision?: (revision: number) => void;
  /** Called after a successful save with paths that are not still pending locally. */
  onWritten?: (writtenPaths: string[], data: Record<string, unknown>, stillPending: Set<string>) => void;
  onSignaturesVoided?: () => void;
};

export type AutosaveQueue = {
  schedule: (path: string, value: unknown) => void;
  flush: (path: string) => Promise<void>;
  /** Saves every pending field immediately (sequentially). Resolves when all are saved or failed. */
  flushAll: () => Promise<"ok" | "failed">;
  /** Best-effort save for unload; uses sendBeacon or keepalive fetch. */
  flushKeepalive: () => void;
  isDirty: () => boolean;
  hasFailed: () => boolean;
  pendingEntries: () => { path: string; value: unknown }[];
  block: (path: string) => void;
  unblock: (path: string) => void;
  dropPending: (path: string) => void;
  dispose: () => void;
};

/**
 * Debounced field queue with sequential saves and conflict handling.
 * Pure of React so `flushAll` can be unit-tested.
 */
export function createAutosaveQueue(options: {
  save: AutosaveSave;
  getRevision: () => number;
  debounceMs?: number;
  enabled?: () => boolean;
  hooks?: AutosaveHooks;
  /** Used on pagehide / visibility hidden. */
  keepaliveSave?: (input: {
    fields: { path: string; value: unknown }[];
    expectedRevision: number;
  }) => void;
}): AutosaveQueue {
  const debounceMs = options.debounceMs ?? 800;
  const pending = new Map<string, unknown>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const blocked = new Set<string>();
  const failed = new Set<string>();
  let saving = false;
  let chain: Promise<void> = Promise.resolve();
  let disposed = false;

  function isDirty() {
    return pending.size > 0 || failed.size > 0 || saving || timers.size > 0;
  }

  function hasFailed() {
    return failed.size > 0;
  }

  function clearTimer(path: string) {
    const existing = timers.get(path);
    if (existing) clearTimeout(existing);
    timers.delete(path);
  }

  function clearAllTimers() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  function schedule(path: string, value: unknown) {
    if (disposed || blocked.has(path)) return;
    if (options.enabled && !options.enabled()) return;
    failed.delete(path);
    pending.set(path, value);
    clearTimer(path);
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        void enqueueFlush(path);
      }, debounceMs),
    );
  }

  function enqueueFlush(path: string): Promise<void> {
    chain = chain.then(() => flushOne(path));
    return chain;
  }

  async function flushOne(path: string): Promise<void> {
    if (disposed || saving || blocked.has(path) || !pending.has(path)) return;
    const value = pending.get(path);
    pending.delete(path);
    saving = true;
    options.hooks?.onUi?.(path, { state: "saving" });
    try {
      const result = await options.save({
        path,
        value,
        expectedRevision: options.getRevision(),
      });
      if (result.ok) {
        failed.delete(path);
        options.hooks?.onRevision?.(result.revision);
        options.hooks?.onWritten?.(result.writtenPaths, result.data, new Set(pending.keys()));
        options.hooks?.onUi?.(path, { state: "saved" });
        if (result.signaturesVoided) options.hooks?.onSignaturesVoided?.();
      } else if (isConflict(result)) {
        options.hooks?.onRevision?.(result.revision);
        blocked.add(path);
        options.hooks?.onUi?.(path, {
          state: "conflict",
          message: formatConflict(result),
          conflict: result,
        });
      } else {
        pending.set(path, value);
        failed.add(path);
        options.hooks?.onUi?.(path, { state: "idle", error: result.message });
      }
    } catch {
      pending.set(path, value);
      failed.add(path);
      options.hooks?.onUi?.(path, { state: "idle", error: "That value could not be saved." });
    } finally {
      saving = false;
    }
  }

  async function flushAll(): Promise<"ok" | "failed"> {
    if (disposed) return failed.size > 0 ? "failed" : "ok";
    clearAllTimers();
    await chain;
    // Snapshot paths so conflict-blocked fields are skipped and order stays stable.
    const paths = [...pending.keys()].filter((path) => !blocked.has(path));
    for (const path of paths) {
      if (!pending.has(path) || blocked.has(path)) continue;
      await flushOne(path);
    }
    const stillOpen = [...pending.keys()].some((path) => !blocked.has(path));
    return stillOpen || failed.size > 0 ? "failed" : "ok";
  }

  function flushKeepalive() {
    if (disposed) return;
    clearAllTimers();
    const fields = [...pending.entries()].map(([path, value]) => ({ path, value }));
    if (fields.length === 0 || !options.keepaliveSave) return;
    options.keepaliveSave({ fields, expectedRevision: options.getRevision() });
    pending.clear();
    failed.clear();
  }

  function dispose() {
    disposed = true;
    clearAllTimers();
  }

  return {
    schedule,
    flush: enqueueFlush,
    flushAll,
    flushKeepalive,
    isDirty,
    hasFailed,
    pendingEntries: () => [...pending.entries()].map(([path, value]) => ({ path, value })),
    block: (path) => blocked.add(path),
    unblock: (path) => blocked.delete(path),
    dropPending: (path) => {
      clearTimer(path);
      pending.delete(path);
      failed.delete(path);
    },
    dispose,
  };
}

/** POST body for the keepalive / beacon field save endpoint. */
export function keepaliveSavePayload(input: {
  fields: { path: string; value: unknown }[];
  expectedRevision: number;
}): string {
  return JSON.stringify(input);
}

export function postKeepaliveSave(instanceId: string, body: string): void {
  postKeepalive(`/api/forms/${instanceId}/fields`, body);
}

/** sendBeacon, or a keepalive fetch, to a save route. */
export function postKeepalive(url: string, body: string): void {
  const blob = typeof Blob !== "undefined" ? new Blob([body], { type: "application/json" }) : null;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && blob) {
    if (navigator.sendBeacon(url, blob)) return;
  }
  if (typeof fetch === "function") {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    });
  }
}
