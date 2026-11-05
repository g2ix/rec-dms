import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "@/server/auth/rate-limit";

describe("rate limiter", () => {
  it("blocks the next hit after the limit inside one window", async () => {
    const limiter = createMemoryRateLimiter();
    const now = new Date("2026-11-05T02:00:00.000Z");
    for (let count = 0; count < 10; count += 1) {
      await expect(limiter.hit("signin:1", 10, 60_000, now)).resolves.toMatchObject({ ok: true });
    }
    await expect(limiter.hit("signin:1", 10, 60_000, now)).resolves.toEqual({ ok: false, remaining: 0 });
    const later = new Date(now.getTime() + 60_000);
    await expect(limiter.hit("signin:1", 10, 60_000, later)).resolves.toMatchObject({ ok: true });
  });
});
