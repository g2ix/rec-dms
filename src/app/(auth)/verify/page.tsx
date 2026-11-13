import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame, AuthLegal } from "@/components/auth/auth-frame";
import { VerifyForm } from "@/components/auth/credential-forms";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  await redirectAwayFromAuthEntry("/verify", email ? `?email=${encodeURIComponent(email)}` : "");
  if (!email) redirect("/sign-up");
  return (
    <AuthFrame
      title="Verify your email"
      footer={
        <>
          <p className="signin-join">
            Wrong address? <Link href={`/sign-up?email=${encodeURIComponent(email)}`}>Go back</Link>
          </p>
          <AuthLegal />
        </>
      }
    >
      <VerifyForm email={email} />
    </AuthFrame>
  );
}
