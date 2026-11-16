import "server-only";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { logMailFailed, logMailSent } from "@/server/mail/log";
import { smtpOptions } from "@/server/mail/smtp";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(message: OutboundMail): Promise<void>;
};

export function smtpMailer(): Mailer {
  const transport = nodemailer.createTransport(smtpOptions());
  return {
    async send(message) {
      try {
        const info = await transport.sendMail({ from: env.EMAIL_FROM, ...message });
        logMailSent("plain", message.to, info);
      } catch (error) {
        logMailFailed("plain", message.to, error);
        throw error;
      }
    },
  };
}

export function resendMailer(apiKey = env.RESEND_API_KEY): Mailer {
  const client = new Resend(apiKey);
  return {
    async send(message) {
      try {
        if (!apiKey) throw new Error("RESEND_API_KEY is empty.");
        const result = await client.emails.send({ from: env.EMAIL_FROM, ...message });
        if (result.error) throw new Error(result.error.message);
        logMailSent("plain", message.to, { messageId: result.data?.id });
      } catch (error) {
        logMailFailed("plain", message.to, error);
        throw error;
      }
    },
  };
}

/** Plain-text mail (sign-in codes, invitations) through the driver MAIL_DRIVER picks. */
export function defaultMailer(): Mailer {
  return env.MAIL_DRIVER === "resend" ? resendMailer() : smtpMailer();
}
