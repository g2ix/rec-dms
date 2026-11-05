import { headers } from "next/headers";
import { SignedInChrome } from "@/components/shell/signed-in";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-rec-pathname") ?? "";
  const pageTitle = pathname.startsWith("/admin/audit")
    ? "Audit log"
    : pathname.startsWith("/admin/users/pending")
      ? "Pending users"
      : "Users";
  return <SignedInChrome pageTitle={pageTitle}>{children}</SignedInChrome>;
}
