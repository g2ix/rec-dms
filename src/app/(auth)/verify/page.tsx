import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/auth/credential-forms";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  await redirectAwayFromAuthEntry("/verify", email ? `?email=${encodeURIComponent(email)}` : "");
  if (!email) redirect("/sign-up");
  return <VerifyForm email={email} />;
}
