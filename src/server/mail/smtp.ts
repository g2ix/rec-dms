import "server-only";
import { env } from "@/lib/env";

/**
 * The one SMTP configuration for every sender (notices, sign-in codes, the Auth.js magic link).
 * The timeouts make a slow or silent server fail the send instead of holding a serverless
 * function until the platform kills it.
 */
export function smtpOptions(url = env.SMTP_URL) {
  return {
    url,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}
