import Link from "next/link";
import { AuthFrame, AuthLegal } from "@/components/auth/auth-frame";
import { SignInForm } from "@/components/auth/sign-in-form";
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
    <AuthFrame
      title="Sign in to REC-DMS"
      footer={
        <>
          <p className="signin-join">
            New to REC-DMS? <Link href="/sign-up">Create an account</Link>
          </p>
          <AuthLegal />
        </>
      }
    >
      <SignInForm
        notice={notice}
        pageError={pageError}
        linkSent={Boolean(query.sent)}
        googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
        callbackUrl={callbackUrl}
      />
    </AuthFrame>
  );
}
