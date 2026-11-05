import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { audit } from "@/server/audit";

function authorized(header: string | null): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function seqParam(value: string | null): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await audit.verifyChain({
    fromSeq: seqParam(url.searchParams.get("fromSeq")),
    toSeq: seqParam(url.searchParams.get("toSeq")),
  });
  return NextResponse.json({
    ok: result.ok,
    seq: result.seq === null ? null : result.seq.toString(),
  });
}
