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
  // PDF conversion is selected in M10. Empty until Gotenberg or LibreOffice is configured.
  GOTENBERG_URL: z.string().default(""),
  GOTENBERG_SECRET: z.string().default(""),
  SMTP_URL: z.string().min(1),
  EMAIL_FROM: z.string().min(1),
  APP_TIMEZONE: z.string().min(1).default("Asia/Manila"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
  // Bearer secret for the M09 chain-verification cron. Empty refuses the route.
  CRON_SECRET: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
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
  return parsed.data;
}

export const env = loadEnv();
