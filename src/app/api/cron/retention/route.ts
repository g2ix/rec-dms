import { NextResponse } from "next/server";
import { cronAuthorized } from "@/server/jobs/cron-auth";
import { flagRetention } from "@/server/privacy/retention";

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await flagRetention();
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  return GET(request);
}
