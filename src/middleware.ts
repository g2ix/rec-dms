import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthEntryPath,
  isProtectedPath,
  resolveStartPage,
  verificationEmail,
} from "@/lib/auth-redirect";
import { apiPathNeedsTotp, isApiPath, owesTotp, TOTP_REQUIRED_MESSAGE } from "@/lib/api-totp";
import { sameOriginHost, totpCookieValid } from "@/lib/totp-cookie";

function forward(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-rec-pathname", pathname);
  requestHeaders.set("x-rec-search", search);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-request-id", requestId);
  return response;
}

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

  // Route handlers: refuse user data and writes until the authenticator check passes.
  if (isApiPath(pathname)) {
    if (userId && token?.needsTotp === true && apiPathNeedsTotp(pathname)) {
      const totpOk = await totpCookieValid(
        request.cookies.get("recdms_totp")?.value,
        userId,
        process.env.AUTH_SECRET ?? "",
      );
      if (owesTotp({ userId, needsTotp: true, totpOk })) {
        return NextResponse.json(
          { error: TOTP_REQUIRED_MESSAGE, code: "TOTP_REQUIRED" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    return forward(request);
  }

  if (request.headers.has("next-action")) {
    const origin = request.headers.get("origin");
    let originHost = "";
    try {
      originHost = origin ? new URL(origin).host : "";
    } catch {
      originHost = "";
    }
    if (!sameOriginHost(originHost, request.nextUrl.host, process.env.NODE_ENV !== "production")) {
      return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
    }
  }

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
        secure: request.nextUrl.protocol === "https:",
      });
    }
    return response;
  }

  const needsTotp = token?.needsTotp === true;
  const totpOk = await totpCookieValid(
    request.cookies.get("recdms_totp")?.value,
    userId ?? "",
    process.env.AUTH_SECRET ?? "",
  );
  if (userId && !blocked && needsTotp && !totpOk && isProtectedPath(pathname) && pathname !== "/app/account/security") {
    if (request.headers.has("next-action")) {
      return NextResponse.json({ error: TOTP_REQUIRED_MESSAGE }, { status: 403 });
    }
    const check = new URL("/app/account/security", request.nextUrl);
    if (pathname !== "/app" || search) check.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(check);
  }

  if (!userId && isProtectedPath(pathname)) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const response = forward(request);
  if (userId && !blocked && !request.cookies.get("activeView")?.value) {
    const start = resolveStartPage({ identityDefaultView, lastUsedView: null });
    if (start.view) {
      response.cookies.set("activeView", start.view, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
      });
    }
  }
  return response;
}

export const config = {
  matcher: ["/", "/sign-in", "/sign-up", "/verify/:path*", "/app", "/app/:path*", "/admin", "/admin/:path*", "/api/:path*"],
};
