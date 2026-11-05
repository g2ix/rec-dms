import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/auth/credential-forms";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  if (!email) redirect("/sign-up");
  return <VerifyForm email={email} />;
}
