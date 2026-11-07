import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";

describe("security headers", () => {
  it("sets the content security policy and frame policy", () => {
    const headers = securityHeaders({ storageOrigin: "https://example.supabase.co", hsts: true });
    const csp = headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://example.supabase.co");
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(headers.some((header) => header.key === "Strict-Transport-Security")).toBe(true);
    expect(headers.some((header) => header.key === "Referrer-Policy")).toBe(true);
    expect(headers.some((header) => header.key === "Permissions-Policy")).toBe(true);
  });

  it("omits HSTS outside production", () => {
    const headers = securityHeaders({ storageOrigin: "https://example.supabase.co", hsts: false });
    expect(headers.some((header) => header.key === "Strict-Transport-Security")).toBe(false);
  });
});
