import { afterEach, describe, expect, it, vi } from "vitest";

const required = {
  DATABASE_URL: "postgresql://recdms:recdms@127.0.0.1:5432/recdms_test",
  DIRECT_URL: "postgresql://recdms:recdms@127.0.0.1:5432/recdms_test",
  AUTH_SECRET: "test-secret",
  AUTH_URL: "http://127.0.0.1:3000",
  S3_ENDPOINT: "http://127.0.0.1:9000",
  S3_BUCKET: "recdms-files",
  S3_ACCESS_KEY: "minio",
  S3_SECRET_KEY: "minio12345",
  S3_REGION: "us-east-1",
  SMTP_URL: "smtp://127.0.0.1:1025",
  EMAIL_FROM: "REC-DMS <noreply@localhost>",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env", () => {
  it("fails fast when DATABASE_URL is missing", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(required)) {
      vi.stubEnv(key, value);
    }
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("@/lib/env")).rejects.toThrow(/DATABASE_URL/);
  });

  it("loads when every required variable is set", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(required)) {
      vi.stubEnv(key, value);
    }

    const { loadEnv } = await import("@/lib/env");
    const source: Record<string, string | undefined> = { ...required };
    delete source.AUTH_SECRET;

    expect(() => loadEnv(source)).toThrow(/AUTH_SECRET/);
    expect(loadEnv(required).APP_TIMEZONE).toBe("Asia/Manila");
  });

  it("requires the key for the chosen mail driver", async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(required)) {
      vi.stubEnv(key, value);
    }
    const { loadEnv } = await import("@/lib/env");

    expect(() => loadEnv({ ...required, SMTP_URL: "" })).toThrow(/SMTP_URL/);
    expect(() => loadEnv({ ...required, MAIL_DRIVER: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(loadEnv({ ...required, SMTP_URL: "", MAIL_DRIVER: "resend", RESEND_API_KEY: "re_test" }).MAIL_DRIVER).toBe("resend");
  });
});
