import { describe, expect, it } from "vitest";
import { sameOriginHost, signTotpCookie, totpCookieValid } from "@/lib/totp-cookie";

describe("totp session cookie", () => {
  it("accepts a cookie it just signed", async () => {
    const value = await signTotpCookie("user-1", "secret", 1_000);
    await expect(totpCookieValid(value, "user-1", "secret", 1_000)).resolves.toBe(true);
    await expect(totpCookieValid(value, "user-2", "secret", 1_000)).resolves.toBe(false);
    await expect(totpCookieValid(value, "user-1", "other", 1_000)).resolves.toBe(false);
  });

  it("treats localhost and 127.0.0.1 as the same host in development", () => {
    expect(sameOriginHost("127.0.0.1:3000", "localhost:3000", true)).toBe(true);
    expect(sameOriginHost("127.0.0.1:3000", "localhost:3000", false)).toBe(false);
  });
});
