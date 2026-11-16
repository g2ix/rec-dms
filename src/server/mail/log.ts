import "server-only";
import { env } from "@/lib/env";
import { log } from "@/server/log";

/** Where mail goes, without credentials: "smtp.gmail.com:465", "127.0.0.1:1025" or "resend". */
export function mailTarget(): string {
  if (env.MAIL_DRIVER === "resend") return "resend";
  if (env.SMTP_HOST) return `${env.SMTP_HOST}:${env.SMTP_PORT}`;
  try {
    const url = new URL(env.SMTP_URL);
    return url.host;
  } catch {
    return "invalid SMTP_URL";
  }
}

/** Only the domain, so logs show where mail went without holding the address. */
function recipientDomain(to: string): string {
  const at = to.lastIndexOf("@");
  return at >= 0 ? to.slice(at + 1).replace(/>$/, "") : "unknown";
}

type SentInfo = {
  messageId?: string;
  response?: string;
  accepted?: unknown[];
  rejected?: unknown[];
};

export function logMailSent(kind: string, to: string, info: SentInfo = {}): void {
  log.info(
    {
      kind,
      driver: env.MAIL_DRIVER,
      target: mailTarget(),
      toDomain: recipientDomain(to),
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted?.length,
      rejected: info.rejected?.length,
    },
    "mail.sent",
  );
}

export function logMailFailed(kind: string, to: string, error: unknown): void {
  const detail = error as { code?: string; responseCode?: number; response?: string };
  log.error(
    {
      kind,
      driver: env.MAIL_DRIVER,
      target: mailTarget(),
      toDomain: recipientDomain(to),
      code: detail?.code,
      responseCode: detail?.responseCode,
      response: detail?.response,
      error: error instanceof Error ? error.message : String(error),
    },
    "mail.failed",
  );
}
