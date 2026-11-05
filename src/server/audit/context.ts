import "server-only";
import type { Prisma } from "@prisma/client";
import { clientIp } from "@/server/auth/rate-limit";

export async function auditRequestMeta(
  extra: Record<string, Prisma.InputJsonValue | null> = {},
  headerList?: Headers,
): Promise<Prisma.InputJsonObject> {
  let current = headerList ?? null;
  if (!current) {
    try {
      const { headers } = await import("next/headers");
      current = await headers();
    } catch {
      current = null;
    }
  }
  const ip = current ? clientIp(current) : "unknown";
  return {
    ip: ip === "unknown" ? null : ip,
    userAgent: current?.get("user-agent") ?? null,
    ...extra,
  };
}
