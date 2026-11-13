import Link from "next/link";
import { AuthFrame, AuthLegal } from "@/components/auth/auth-frame";
import { SignUpForm } from "@/components/auth/credential-forms";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  await redirectAwayFromAuthEntry("/sign-up", "");
  const { email } = await searchParams;
  return (
    <AuthFrame
      title="Create your account"
      footer={
        <>
          <p className="signin-join">
            Already registered? <Link href="/sign-in">Sign in</Link>
          </p>
          <AuthLegal />
        </>
      }
    >
      <SignUpForm defaultEmail={email ?? ""} />
    </AuthFrame>
  );
}
