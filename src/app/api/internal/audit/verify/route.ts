import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { cronAuthorized } from "@/server/jobs/cron-auth";

function seqParam(value: string | null): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return BigInt(value);
}

export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
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
