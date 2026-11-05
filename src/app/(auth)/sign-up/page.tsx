import { SignUpForm } from "@/components/auth/credential-forms";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Create an account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  await redirectAwayFromAuthEntry("/sign-up", "");
  const { email } = await searchParams;
  return <SignUpForm defaultEmail={email ?? ""} />;
}
