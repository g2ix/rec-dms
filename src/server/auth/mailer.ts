import "server-only";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";

export type OutboundMail = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(message: OutboundMail): Promise<void>;
};

export function smtpMailer(): Mailer {
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    async send(message) {
      await transport.sendMail({ from: env.EMAIL_FROM, ...message });
    },
  };
}
