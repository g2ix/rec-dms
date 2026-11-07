import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { prisma } from "@/server/db";
import { captureException, logDatabaseLatency } from "@/server/log";
import { storageReachable } from "@/server/storage";

export const dynamic = "force-dynamic";

type Check = "ok" | "down" | "skipped" | "unknown";

async function timed<T>(run: () => Promise<T>): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  try {
    await run();
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    await captureException(error);
    return { ok: false, ms: Date.now() - started };
  }
}

async function probe(url: string, token?: string): Promise<Check> {
  if (!url) return "skipped";
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
      headers,
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    return response.ok ? "ok" : "down";
  } catch (error) {
    await captureException(error);
    return "down";
  }
}

function backupStatus(value: unknown): { status: Check; ageHours: number | null } {
  const at =
    value && typeof value === "object" && !Array.isArray(value) && "at" in value && typeof value.at === "string"
      ? Date.parse(value.at)
      : Number.NaN;
  if (!Number.isFinite(at)) return { status: "unknown", ageHours: null };
  const ageHours = Math.round(((Date.now() - at) / 3_600_000) * 10) / 10;
  return { status: ageHours <= 36 ? "ok" : "down", ageHours };
}

export async function GET() {
  const db = await timed(() => prisma.$queryRaw`SELECT 1`);
  if (db.ok) logDatabaseLatency(db.ms);
  const storage = await timed(() => storageReachable());
  const [pdf, scan, backupRow] = await Promise.all([
    probe(env.GOTENBERG_URL),
    probe(env.CLAMAV_URL, env.CLAMAV_TOKEN),
    prisma.setting.findUnique({ where: { key: "ops.backupAt" } }).catch(() => null),
  ]);
  const backup = backupStatus(backupRow?.value);
  const checks = {
    database: db.ok ? "ok" : "down",
    storage: storage.ok ? "ok" : "down",
    pdf,
    scan,
    backup: backup.status,
  } as const;
  const down = Object.values(checks).some((status) => status === "down");
  return NextResponse.json(
    {
      ok: !down,
      region: process.env.VERCEL_REGION ?? null,
      dbMs: db.ms,
      backupAgeHours: backup.ageHours,
      checks,
    },
    { status: down ? 503 : 200 },
  );
}
