type Flusher = () => Promise<"ok" | "failed">;

const flushers = new Set<Flusher>();

/** Register a form's flushAll so action buttons on the page can drain pending saves first. */
export function registerAutosaveFlusher(flush: Flusher): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Runs every registered flushAll sequentially. Used before Return, Complete, Sign, Submit. */
export async function flushRegisteredAutosaves(): Promise<"ok" | "failed"> {
  let failed = false;
  for (const flush of [...flushers]) {
    if ((await flush()) === "failed") failed = true;
  }
  return failed ? "failed" : "ok";
}
