import "server-only";
import pino from "pino";
import { env } from "@/lib/env";

export const log = pino({
  level: env.LOG_LEVEL || "info",
  base: { service: "rec-dms" },
  messageKey: "message",
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

let reportedLatency = false;

export function logDatabaseLatency(dbMs: number): void {
  if (reportedLatency) return;
  reportedLatency = true;
  log.info({ dbMs, region: process.env.VERCEL_REGION ?? "local" }, "database round trip");
}

/** Optional. Sends one event when SENTRY_DSN is set. Failures are ignored. */
export async function captureException(error: unknown): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    const dsn = new URL(env.SENTRY_DSN);
    const projectId = dsn.pathname.replace(/^\//, "");
    const store = `${dsn.protocol}//${dsn.host}/api/${projectId}/store/?sentry_key=${dsn.username}&sentry_version=7`;
    await fetch(store, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Application error",
        level: "error",
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // A reporting failure must not change the request.
  }
}
