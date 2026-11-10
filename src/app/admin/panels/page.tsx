import Link from "next/link";
import { redirect } from "next/navigation";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { panelOverview } from "@/server/users/roles";

export const metadata = { title: "Panels" };

export default async function PanelsPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const actor = await requireUser();
  try {
    await authorize(actor, "users.manage");
  } catch {
    redirect("/app");
  }
  const { changed } = await searchParams;
  const panels = await panelOverview();

  return (
    <article className="rec-stack">
      <h1 className="title">Panels</h1>
      <p className="body rec-muted">Each discipline suggests a panel. The Panel Chair receives that panel&apos;s chair tasks.</p>
      <p className="body-sm">
        <Link href="/admin/users">Users</Link>
      </p>
      {changed ? <p className="rec-banner">The Panel Chair was changed.</p> : null}
      {panels.length === 0 ? <p className="body">No panels are set up yet.</p> : null}
      {panels.map((panel) => (
        <section className="rec-card rec-stack" key={panel.id} aria-labelledby={`panel-${panel.id}`}>
          <div>
            <p className="code">{panel.code}</p>
            <h2 className="heading" id={`panel-${panel.id}`}>
              {panel.name}
            </h2>
            {panel.active ? null : <p className="body-sm rec-muted">Inactive</p>}
          </div>
          <div>
            <h3 className="subheading">Disciplines</h3>
            <p className="body">{panel.disciplines.length > 0 ? panel.disciplines.join(", ") : "None"}</p>
          </div>
          <div>
            <h3 className="subheading">Panel Chair</h3>
            {panel.chairs.length === 0 ? <p className="body">No chair assigned</p> : null}
            {panel.chairs.map((chair) => (
              <p className="body" key={chair.id}>
                <Link href={`/admin/users/${chair.userId}`}>{chair.name}</Link>
                {chair.allPanels ? " (all panels)" : ""}
              </p>
            ))}
            {panel.active ? (
              <p className="body-sm">
                <Link href={`/admin/panels/${panel.id}/chair`}>{panel.chairs.length > 0 ? "Change the chair" : "Assign a chair"}</Link>
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="subheading">Members</h3>
            {panel.members.length === 0 ? <p className="body">No members hold a role on this panel.</p> : null}
            {panel.members.map((member) => (
              <p className="body" key={member.id}>
                <Link href={`/admin/users/${member.userId}`}>{member.name}</Link> — {member.roleName}
              </p>
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}
