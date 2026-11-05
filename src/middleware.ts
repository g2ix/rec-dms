import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthEntryPath,
  isProtectedPath,
  resolveStartPage,
  verificationEmail,
} from "@/lib/auth-redirect";

/**
 * Read the session directly. The Auth.js `auth()` wrapper rebuilds every
 * response with `new Response(body, response)`, which drops the server-action
 * flight and leaves the sign-in form stuck on "Signing in…".
 */
export default async function middleware(request: NextRequest) {
  const secure = request.nextUrl.protocol === "https:";
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: secure,
  });
  const userId =
    typeof token?.userId === "string" ? token.userId : typeof token?.sub === "string" ? token.sub : undefined;
  const status = typeof token?.status === "string" ? token.status : undefined;
  const identityDefaultView =
    typeof token?.identityDefaultView === "string" ? token.identityDefaultView : null;
  const { pathname, search } = request.nextUrl;
  const blocked = status === "SUSPENDED" || status === "MERGED";

  if (userId && blocked && isProtectedPath(pathname)) {
    const error = status === "SUSPENDED" ? "Suspended" : "AccessDenied";
    return NextResponse.redirect(new URL(`/sign-in?error=${error}`, request.nextUrl));
  }

  if (userId && !blocked && isAuthEntryPath(pathname) && !verificationEmail(pathname, search)) {
    const start = resolveStartPage({
      identityDefaultView,
      lastUsedView: request.cookies.get("activeView")?.value,
    });
    const response = NextResponse.redirect(new URL(start.path, request.nextUrl));
    if (start.view) {
      response.cookies.set("activeView", start.view, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return response;
  }

  if (!userId && isProtectedPath(pathname)) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-rec-pathname", pathname);
  requestHeaders.set("x-rec-search", search);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (userId && !blocked && !request.cookies.get("activeView")?.value) {
    const start = resolveStartPage({ identityDefaultView, lastUsedView: null });
    if (start.view) {
      response.cookies.set("activeView", start.view, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
  }
  return response;
}

export const config = {
  matcher: ["/", "/sign-in", "/sign-up", "/verify/:path*", "/app", "/app/:path*", "/admin", "/admin/:path*"],
};
