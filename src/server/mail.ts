import "server-only";
import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { paragraphsOf } from "@/lib/notifications/render";
import { NoticeEmail } from "@/server/mail/notice-email";

export const SENDER_NAME = "USC Research Ethics Committee";

export type OutboundHtmlMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type TransactionalMail = {
  send(message: OutboundHtmlMail): Promise<void>;
};

export function senderAddress(from = env.EMAIL_FROM): string {
  const match = from.match(/<([^>]+)>/);
  const address = (match?.[1] ?? from).trim();
  return `${SENDER_NAME} <${address}>`;
}

export async function renderNoticeHtml(input: {
  heading: string;
  text: string;
  actionHref: string | null;
}): Promise<string> {
  return render(
    NoticeEmail({
      heading: input.heading,
      paragraphs: paragraphsOf(input.text),
      actionHref: input.actionHref,
    }),
  );
}

export function smtpTransactionalMail(): TransactionalMail {
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    async send(message) {
      await transport.sendMail({
        from: senderAddress(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

export function resendTransactionalMail(apiKey = env.RESEND_API_KEY): TransactionalMail {
  const client = new Resend(apiKey);
  return {
    async send(message) {
      if (!apiKey) throw new Error("RESEND_API_KEY is empty.");
      const result = await client.emails.send({
        from: senderAddress(),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (result.error) throw new Error(result.error.message);
    },
  };
}

let override: TransactionalMail | null = null;

/** Tests substitute a mailer that records or fails sends. */
export function setTransactionalMail(mail: TransactionalMail | null): void {
  override = mail;
}

export function transactionalMail(): TransactionalMail {
  if (override) return override;
  if (env.MAIL_DRIVER === "resend") return resendTransactionalMail();
  return smtpTransactionalMail();
}
