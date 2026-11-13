/** What the confirmation dialog shows after an action succeeds, and where its OK button goes. */
export type ActionResult = {
  /** What happened, as a sentence. */
  title: string;
  /** Who acts next and by when, read from the workflow. Empty when no one does. */
  body: string | null;
  href: string;
};

export type ActionOutcome = { ok: true; result: ActionResult } | { ok: false; error: string };

/**
 * form: an action taken inside one protocol form.
 * intake: an action taken on the Intake tab (the one signature for F-27 and F-28), which stays there.
 * protocol: an action on the whole protocol, such as submit, return, release, or decide.
 * review: a reviewer's task.
 */
export type ResultTarget = "form" | "intake" | "protocol" | "review" | "other";

export const REVIEWS_PATH = "/app/reviews";

export function resultHref(target: ResultTarget, protocolId: string): string {
  if (target === "review") return REVIEWS_PATH;
  if (target === "form") return `/app/protocols/${protocolId}/forms`;
  if (target === "intake") return `/app/protocols/${protocolId}/intake`;
  return `/app/protocols/${protocolId}`;
}
