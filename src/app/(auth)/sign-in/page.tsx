import Link from "next/link";
import { SignInForm } from "@/components/auth/credential-forms";
import { safeCallbackPath, SUSPENDED_SIGN_IN_MESSAGE } from "@/lib/auth-redirect";
import { env } from "@/lib/env";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  AccessDenied: "That account cannot sign in.",
  Suspended: SUSPENDED_SIGN_IN_MESSAGE,
  OAuthAccountNotLinked: "That Google account uses an email already on a REC-DMS account. Sign in, then link it from Sign-in methods.",
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
  const notice = query.verified
    ? "Email verified. Sign in with your password."
    : query.sent
      ? "If an account exists for that email, a sign-in link is on its way."
      : query.error
        ? (NOTICES[query.error] ?? "Sign-in did not complete.")
        : undefined;

  return (
    <>
      <SignInForm
        notice={notice}
        googleEnabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)}
        callbackUrl={safeCallbackPath(query.callbackUrl) ?? ""}
      />
      <p className="caption">
        <Link href="/">Back to REC-DMS</Link>
      </p>
    </>
  );
}
