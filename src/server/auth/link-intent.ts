import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "rec-link";
const TEN_MINUTES = 10 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set.");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function writeLinkIntent(userId: string): Promise<void> {
  const exp = Date.now() + TEN_MINUTES * 1000;
  const payload = `${userId}.${exp}`;
  const jar = await cookies();
  jar.set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TEN_MINUTES,
  });
}

export async function readLinkIntent(): Promise<{ userId: string } | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  const signature = parts.pop();
  const exp = parts.pop();
  const userId = parts.join(".");
  if (!signature || !exp || !userId) return null;
  const payload = `${userId}.${exp}`;
  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  if (Number(exp) < Date.now()) return null;
  return { userId };
}

export async function clearLinkIntent(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
