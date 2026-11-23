import { redirect } from "next/navigation";
import { UserAdminTabs } from "@/components/admin/user-admin-tabs";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

export default async function UserManagementLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireUser();
  try {
    await authorize(actor, "users.manage");
  } catch {
    redirect("/app");
  }
  const pendingCount = await prisma.user.count({ where: { status: "PENDING_APPROVAL" } });
  return (
    <div className="rec-stack">
      <header className="rec-stack rec-admin-head">
        <h1 className="title">User management</h1>
        <UserAdminTabs pendingCount={pendingCount} />
      </header>
      {children}
    </div>
  );
}
