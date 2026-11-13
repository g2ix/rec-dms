import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signTotpCookie } from "@/lib/totp-cookie";

const getToken = vi.hoisted(() => vi.fn());
vi.mock("next-auth/jwt", () => ({ getToken }));

const { default: middleware, config } = await import("@/middleware");

const SECRET = "middleware-test-secret";

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `recdms_totp=${cookie}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

describe("middleware /api authenticator guard", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    getToken.mockReset();
  });

  it("runs for /api route handlers", () => {
    expect(config.matcher).toContain("/api/:path*");
  });

  it("refuses /api/notifications with 403 JSON while the check is pending", async () => {
    getToken.mockResolvedValue({ userId: "user-1", status: "ACTIVE", needsTotp: true });
    const response = await middleware(request("/api/notifications"));
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ code: "TOTP_REQUIRED" });
  });

  it("refuses a cookie signed for another user", async () => {
    getToken.mockResolvedValue({ userId: "user-1", status: "ACTIVE", needsTotp: true });
    const cookie = await signTotpCookie("user-2", SECRET);
    const response = await middleware(request("/api/protocols/p1/package", cookie));
    expect(response.status).toBe(403);
  });

  it("lets the request through once the check has passed", async () => {
    getToken.mockResolvedValue({ userId: "user-1", status: "ACTIVE", needsTotp: true });
    const cookie = await signTotpCookie("user-1", SECRET);
    const response = await middleware(request("/api/notifications", cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets through a session that does not need the check, and signed-out requests", async () => {
    getToken.mockResolvedValue({ userId: "user-1", status: "ACTIVE", needsTotp: false });
    expect((await middleware(request("/api/notifications"))).headers.get("x-middleware-next")).toBe("1");
    getToken.mockResolvedValue(null);
    expect((await middleware(request("/api/notifications"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps auth, session end, cron and health reachable while the check is pending", async () => {
    getToken.mockResolvedValue({ userId: "user-1", status: "ACTIVE", needsTotp: true });
    for (const path of ["/api/auth/session", "/api/session/end", "/api/cron/jobs", "/api/internal/audit/verify", "/api/health"]) {
      const response = await middleware(request(path));
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
    }
  });
});
