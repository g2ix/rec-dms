import { headers } from "next/headers";
import { SignedInChrome } from "@/components/shell/signed-in";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-rec-pathname") ?? "";
  const pageTitle = pathname.startsWith("/admin/panels")
    ? "Panels"
    : pathname.startsWith("/admin/workflows/")
    ? "Workflow"
    : pathname.startsWith("/admin/workflows")
      ? "Workflows"
      : pathname.startsWith("/admin/notifications")
        ? "Notifications"
      : pathname.startsWith("/admin/holidays")
        ? "Holidays"
        : pathname.startsWith("/admin/audit")
    ? "Audit log"
    : pathname.includes("/try")
      ? "Try form"
      : pathname.startsWith("/admin/forms/new")
        ? "New form"
        : pathname.startsWith("/admin/forms/")
          ? "Edit form"
          : pathname.startsWith("/admin/forms")
            ? "Forms"
            : pathname.startsWith("/admin/users/pending")
              ? "Pending users"
              : "Users";
  return <SignedInChrome pageTitle={pageTitle}>{children}</SignedInChrome>;
}
