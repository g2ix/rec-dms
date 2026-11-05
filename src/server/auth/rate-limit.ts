import "server-only";
import { prisma } from "@/server/db";

export type RateHit = { ok: boolean; remaining: number };

export type RateLimiter = {
  hit(key: string, limit: number, windowMs: number, now?: Date): Promise<RateHit>;
};

export const SIGN_IN_LIMIT = { limit: 10, windowMs: 60_000 };
export const CODE_SEND_LIMIT = { limit: 5, windowMs: 60 * 60_000 };

export function createMemoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, { count: number; windowStart: number }>();
  return {
    async hit(key, limit, windowMs, now = new Date()) {
      const current = buckets.get(key);
      const started = now.getTime();
      if (!current || started - current.windowStart >= windowMs) {
        buckets.set(key, { count: 1, windowStart: started });
        return { ok: true, remaining: limit - 1 };
      }
      if (current.count >= limit) return { ok: false, remaining: 0 };
      current.count += 1;
      return { ok: true, remaining: limit - current.count };
    },
  };
}

export function createDbRateLimiter(): RateLimiter {
  return {
    async hit(key, limit, windowMs, now = new Date()) {
      return prisma.$transaction(async (tx) => {
        const row = await tx.rateLimit.findUnique({ where: { key } });
        if (!row || now.getTime() - row.windowStart.getTime() >= windowMs) {
          await tx.rateLimit.upsert({
            where: { key },
            create: { key, count: 1, windowStart: now },
            update: { count: 1, windowStart: now },
          });
          return { ok: true, remaining: limit - 1 };
        }
        if (row.count >= limit) return { ok: false, remaining: 0 };
        await tx.rateLimit.update({ where: { key }, data: { count: row.count + 1 } });
        return { ok: true, remaining: limit - row.count - 1 };
      });
    },
  };
}

export const rateLimiter = createDbRateLimiter();

export function clientIp(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headerList.get("x-real-ip") ?? "unknown";
}
