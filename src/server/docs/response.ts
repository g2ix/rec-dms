import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";

export function fileResponse(bytes: Uint8Array, name: string, mime: string, inline: boolean): NextResponse {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
