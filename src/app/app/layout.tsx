import { SignedInChrome } from "@/components/shell/signed-in";

export default function SignedInLayout({ children }: { children: React.ReactNode }) {
  return <SignedInChrome>{children}</SignedInChrome>;
}
