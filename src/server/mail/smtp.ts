import "server-only";
import { env } from "@/lib/env";

type SmtpSettings = Pick<
  typeof env,
  "SMTP_URL" | "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASS" | "SMTP_SECURE"
>;

/**
 * The one SMTP configuration for every sender (notices, sign-in codes, the Auth.js magic link).
 * SMTP_HOST with SMTP_PORT, SMTP_USER and SMTP_PASS (Gmail, a relay) wins over SMTP_URL (Mailpit).
 * The timeouts make a slow or silent server fail the send instead of holding a serverless
 * function until the platform kills it.
 */
export function smtpOptions(settings: SmtpSettings = env) {
  const timeouts = {
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
  if (!settings.SMTP_HOST) return { url: settings.SMTP_URL, ...timeouts };
  const secure = settings.SMTP_SECURE
    ? settings.SMTP_SECURE === "true"
    : settings.SMTP_PORT === 465;
  return {
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    secure,
    auth: settings.SMTP_USER ? { user: settings.SMTP_USER, pass: settings.SMTP_PASS } : undefined,
    ...timeouts,
  };
}
