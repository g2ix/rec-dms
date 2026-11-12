import { NextResponse } from "next/server";
import { signOut } from "@/server/auth";
import { AppError } from "@/server/errors";
import { requireUser } from "@/server/session";

/**
 * Ends a session that can no longer be used: the account is suspended, merged or gone. A page
 * cannot change cookies while it renders, so the signed-in shell sends such a session here.
 * An active session is left alone and sent back to the app, so this link cannot sign anyone out.
 */
export async function GET() {
  try {
    await requireUser();
  } catch (error) {
    if (error instanceof AppError && error.code === "SUSPENDED") return signOut({ redirectTo: "/sign-in?error=Suspended" });
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") return signOut({ redirectTo: "/sign-in" });
    throw error;
  }
  return NextResponse.redirect(new URL("/app", process.env.AUTH_URL ?? "http://localhost:3000"));
}
