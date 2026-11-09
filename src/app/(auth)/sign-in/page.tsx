import Link from "next/link";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Seal } from "@/components/brand/seal";
import { ThemeIconSwitch } from "@/components/theme/theme-switch";
import { safeCallbackPath, SUSPENDED_SIGN_IN_MESSAGE } from "@/lib/auth-redirect";
import { env } from "@/lib/env";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  AccessDenied: "That account cannot sign in.",
  Suspended: SUSPENDED_SIGN_IN_MESSAGE,
  OAuthAccountNotLinked:
    "That Google account uses an email already on a REC-DMS account. Sign in, then link it from Sign-in methods.",
  RateLimited: "Too many sign-in attempts. Wait a minute and try again.",
  Configuration: "Sign-in is not configured completely.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; verified?: string; code?: string; callbackUrl?: string }>;
}) {
  const query = await searchParams;
  await redirectAwayFromAuthEntry("/sign-in", "");
  const callbackUrl = safeCallbackPath(query.callbackUrl) ?? "";
  const notice = query.verified ? "Email verified. Sign in with your password." : undefined;
  const pageError = query.error ? (NOTICES[query.error] ?? "Sign-in did not complete.") : undefined;

  return (
    <div className="signin">
      <div className="site-rule" aria-hidden="true" />
      <Link className="signin-back" href="/">
        ← Back to REC-DMS
      </Link>
      <main className="signin-main">
        <Seal size={80} alt="" priority />
        <h1 className="signin-title">Sign in to REC-DMS</h1>
        <p className="signin-sub">University of San Carlos Research Ethics Committee</p>
        <SignInForm
          notice={notice}
          pageError={pageError}
          linkSent={Boolean(query.sent)}
          googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
          callbackUrl={callbackUrl}
        />
        <p className="signin-join">
          New to REC-DMS? <Link href="/sign-up">Create an account</Link>
        </p>
        <p className="signin-legal">
          By signing in you agree to the <Link href="/privacy">Privacy notice</Link>. Trouble signing in? Contact the REC office.
        </p>
      </main>
      <div className="signin-theme">
        <ThemeIconSwitch />
      </div>
    </div>
  );
}
