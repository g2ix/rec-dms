import { cookies } from "next/headers";
import { DashboardView } from "@/components/reports/dashboard-view";
import { ProponentDashboard } from "@/components/reports/proponent-dashboard";
import { resolveRoleView } from "@/server/auth/view";
import { recentActivity } from "@/server/reports/activity";
import { loadDashboard } from "@/server/reports/dashboard";
import { getPersonProfile } from "@/server/profiles/profile";
import { requireUser } from "@/server/session";

export async function RoleHome() {
  const user = await requireUser();
  const jar = await cookies();
  const { view } = await resolveRoleView(user.id, jar.get("activeView")?.value);
  const model = await loadDashboard(user.id, view);
  if (model.view === "proponent") {
    const [profile, activity] = await Promise.all([getPersonProfile(user.id), recentActivity(user.id)]);
    return <ProponentDashboard model={model} profile={profile} activity={activity} viewerName={user.displayName} />;
  }
  return (
    <article className="rec-stack">
      <h1 className="title">Dashboard</h1>
      <DashboardView model={model} />
    </article>
  );
}
