import { SignUpForm } from "@/components/auth/credential-forms";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata = { title: "Create an account" };

export default async function SignUpPage() {
  await redirectAwayFromAuthEntry("/sign-up", "");
  return <SignUpForm />;
}
