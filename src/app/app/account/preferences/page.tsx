import Link from "next/link";
import { StartRoleForm } from "@/components/account/start-role-form";
import { ROLE_LABEL } from "@/components/shell/nav";
import type { RoleView } from "@/lib/role-view";
import { roleViewsOf } from "@/server/auth/view";
import { startRoleOf } from "@/server/auth/start-role";
import { requireUser } from "@/server/session";

export const metadata = { title: "Preferences" };

const ROLE_DETAIL: Record<RoleView, string> = {
  proponent: "Your protocols and what the REC needs from you.",
  adviser: "Protocols you advise and endorsements waiting.",
  reviewer: "Reviews assigned to you.",
  "panel-chair": "Your panel's protocols and reviewer load.",
  staff: "Screening, fees, releases, and accounts.",
  chair: "Decisions to sign and committee appointments.",
};

export default async function PreferencesPage() {
  const user = await requireUser();
  const [{ views }, saved] = await Promise.all([roleViewsOf(user.id), startRoleOf(user.id)]);
  const options = [
    { value: "last" as const, title: "The role I used last", detail: "Pick up where you left off." },
    ...views.map((view) => ({ value: view, title: ROLE_LABEL[view], detail: ROLE_DETAIL[view] })),
  ];
  return (
    <article className="rec-stack details-page">
      <div className="details-intro">
        <h1 className="title">Preferences</h1>
        <p className="body rec-muted">How REC-DMS opens for you.</p>
      </div>
      <section className="rec-card rec-stack" aria-labelledby="start-role">
        <div>
          <h2 id="start-role" className="subheading">
            Role at sign-in
          </h2>
          <p className="body-sm rec-muted">
            {views.length > 1
              ? "Each time you sign in, REC-DMS opens in this role. You can still switch roles from the sidebar at any time."
              : `You hold one role, ${ROLE_LABEL[views[0] ?? "proponent"]}, so REC-DMS always opens in it. More choices appear here when you are given another role.`}
          </p>
        </div>
        {views.length > 1 ? <StartRoleForm options={options} saved={saved && views.includes(saved) ? saved : "last"} /> : null}
      </section>
      <section className="rec-card rec-stack" aria-labelledby="notify-pref">
        <div>
          <h2 id="notify-pref" className="subheading">
            Email for reminders
          </h2>
          <p className="body-sm rec-muted">Immediate email, or one daily digest at 7:00.</p>
        </div>
        <div className="rec-actions">
          <Link className="rec-btn rec-btn--secondary" href="/app/account/notifications">
            <span>Notification preferences</span>
          </Link>
        </div>
      </section>
    </article>
  );
}
