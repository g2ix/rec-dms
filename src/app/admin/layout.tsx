import { SignedInChrome } from "@/components/shell/signed-in";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <SignedInChrome pageTitle="Users">{children}</SignedInChrome>;
}
