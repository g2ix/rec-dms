import { describe, expect, it } from "vitest";
import { apiPathNeedsTotp, isApiPath, owesTotp } from "@/lib/api-totp";

describe("api totp guard", () => {
  it("guards every route handler that returns user data or changes state", () => {
    for (const path of [
      "/api/notifications",
      "/api/account/export",
      "/api/forms/abc/document",
      "/api/forms/abc/fields",
      "/api/protocols/abc/checklist",
      "/api/protocols/abc/intake",
      "/api/protocols/abc/package",
    ]) {
      expect(apiPathNeedsTotp(path), path).toBe(true);
    }
  });

  it("leaves auth, session end, cron, internal, webhook and health routes reachable", () => {
    for (const path of [
      "/api/auth/session",
      "/api/auth/callback/credentials",
      "/api/session/end",
      "/api/cron/digest",
      "/api/internal/audit/verify",
      "/api/webhooks/resend",
      "/api/health",
    ]) {
      expect(apiPathNeedsTotp(path), path).toBe(false);
    }
  });

  it("matches exempt prefixes on segment boundaries only", () => {
    expect(apiPathNeedsTotp("/api/authority")).toBe(true);
    expect(apiPathNeedsTotp("/api/session/ended")).toBe(true);
    expect(apiPathNeedsTotp("/api/healthz")).toBe(true);
  });

  it("only applies to /api paths", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
    expect(apiPathNeedsTotp("/app/notifications")).toBe(false);
  });

  it("owes the check only for a signed-in session without a valid cookie", () => {
    expect(owesTotp({ userId: "u", needsTotp: true, totpOk: false })).toBe(true);
    expect(owesTotp({ userId: "u", needsTotp: true, totpOk: true })).toBe(false);
    expect(owesTotp({ userId: "u", needsTotp: false, totpOk: false })).toBe(false);
    expect(owesTotp({ userId: undefined, needsTotp: true, totpOk: false })).toBe(false);
  });
});
