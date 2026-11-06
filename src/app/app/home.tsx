import { cookies } from "next/headers";
import { DashboardView } from "@/components/reports/dashboard-view";
import { resolveRoleView } from "@/server/auth/view";
import { loadDashboard } from "@/server/reports/dashboard";
import { requireUser } from "@/server/session";

export async function RoleHome() {
  const user = await requireUser();
  const jar = await cookies();
  const { view } = await resolveRoleView(user.id, jar.get("activeView")?.value);
  const model = await loadDashboard(user.id, view);
  return (
    <article className="rec-stack">
      <h1 className="title">Dashboard</h1>
      <DashboardView model={model} />
    </article>
  );
}
