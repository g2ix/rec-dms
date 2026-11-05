import { NextResponse } from "next/server";
import { assertCanViewAudit } from "@/server/audit/access";
import { auditEventsCsv, parseAuditFilters } from "@/server/audit/query";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await assertCanViewAudit(user.id);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 401;
    const message = error instanceof AppError ? error.message : "Sign in to continue.";
    return new NextResponse(message, { status });
  }

  const url = new URL(request.url);
  const csv = await auditEventsCsv(parseAuditFilters(Object.fromEntries(url.searchParams)));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
      "Cache-Control": "no-store",
    },
  });
}
