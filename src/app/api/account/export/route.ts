import { NextResponse } from "next/server";
import { exportUserData } from "@/server/privacy/export";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

export async function GET() {
  try {
    const user = await requireUser();
    const data = await exportUserData(user.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="rec-dms-data.json"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const message = error instanceof AppError ? error.message : "The export could not be prepared.";
    return NextResponse.json({ error: message }, { status });
  }
}
