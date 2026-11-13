import "server-only";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().min(1),
  // libreoffice-local uses soffice. gotenberg posts to GOTENBERG_URL.
  // "soffice" is the earlier name for libreoffice-local.
  PDF_CONVERTER: z.enum(["gotenberg", "libreoffice-local", "soffice"]).default("libreoffice-local"),
  GOTENBERG_URL: z.string().default(""),
  GOTENBERG_USERNAME: z.string().default(""),
  GOTENBERG_PASSWORD: z.string().default(""),
  // Older installs sent one secret. A value with a colon is user:password.
  GOTENBERG_SECRET: z.string().default(""),
  CLAMAV_URL: z.string().default(""),
  CLAMAV_TOKEN: z.string().default(""),
  // Required when MAIL_DRIVER is smtp.
  SMTP_URL: z.string().default(""),
  EMAIL_FROM: z.string().min(1),
  // smtp uses SMTP_URL (Mailpit or a relay). resend uses RESEND_API_KEY.
  MAIL_DRIVER: z.enum(["smtp", "resend"]).default("smtp"),
  RESEND_API_KEY: z.string().default(""),
  APP_TIMEZONE: z.string().min(1).default("Asia/Manila"),
  APP_BASE_URL: z.string().default(""),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
  // Bearer secret for Cloud Scheduler. Empty refuses every cron route.
  CRON_SECRET: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
  LOG_LEVEL: z.string().default("info"),
});

export type Env = z.infer<typeof envSchema> & {
  pdfConverter: "gotenberg" | "libreoffice-local";
};

function pdfConverterOf(value: Env["PDF_CONVERTER"]): Env["pdfConverter"] {
  return value === "gotenberg" ? "gotenberg" : "libreoffice-local";
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.join(".") || "(root)";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid environment. ${details}`);
  }
  const data = parsed.data;
  if (data.MAIL_DRIVER === "smtp" && !data.SMTP_URL) {
    throw new Error("Invalid environment. SMTP_URL is required when MAIL_DRIVER is smtp.");
  }
  if (data.MAIL_DRIVER === "resend" && !data.RESEND_API_KEY) {
    throw new Error("Invalid environment. RESEND_API_KEY is required when MAIL_DRIVER is resend.");
  }
  const production = source.VERCEL_ENV === "production";
  if (production) {
    const missing: string[] = [];
    if (!data.CRON_SECRET) missing.push("CRON_SECRET");
    if (!data.APP_BASE_URL) missing.push("APP_BASE_URL");
    if (!data.CLAMAV_URL) missing.push("CLAMAV_URL");
    if (!data.CLAMAV_TOKEN) missing.push("CLAMAV_TOKEN");
    if (pdfConverterOf(data.PDF_CONVERTER) === "gotenberg") {
      if (!data.GOTENBERG_URL) missing.push("GOTENBERG_URL");
      if (!data.GOTENBERG_USERNAME) missing.push("GOTENBERG_USERNAME");
      if (!data.GOTENBERG_PASSWORD) missing.push("GOTENBERG_PASSWORD");
    }
    if (missing.length > 0) {
      throw new Error(`Invalid environment. Production requires ${missing.join(", ")}.`);
    }
    try {
      if (data.APP_BASE_URL) new URL(data.APP_BASE_URL);
    } catch {
      throw new Error("Invalid environment. APP_BASE_URL: must be a URL.");
    }
  }
  return { ...data, pdfConverter: pdfConverterOf(data.PDF_CONVERTER) };
}

export const env = loadEnv();

/** Public site origin. Preview and production set APP_BASE_URL; local uses AUTH_URL. */
export function appBaseUrl(): string {
  return (env.APP_BASE_URL || env.AUTH_URL).replace(/\/$/, "");
}
