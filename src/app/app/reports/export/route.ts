import { NextResponse } from "next/server";
import { errorResponse } from "@/server/docs/response";
import { AppError } from "@/server/errors";
import { parseReportFilters, reportCsv } from "@/server/reports/query";
import { requireUser } from "@/server/session";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const filters = parseReportFilters(Object.fromEntries(url.searchParams.entries()));
    const csv = await reportCsv(user.id, filters);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"rec-report.csv\"",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return errorResponse(error);
  }
}
