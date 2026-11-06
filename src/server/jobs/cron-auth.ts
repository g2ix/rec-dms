import "server-only";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

export function cronAuthorized(header: string | null): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
