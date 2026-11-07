import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { cronAuthorized } from "@/server/jobs/cron-auth";

export async function POST(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const at = new Date().toISOString();
  await prisma.setting.upsert({
    where: { key: "ops.backupAt" },
    create: { key: "ops.backupAt", value: { at } },
    update: { value: { at } },
  });
  return NextResponse.json({ ok: true, at });
}
