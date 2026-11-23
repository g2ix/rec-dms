import Link from "next/link";
import { ArrowRightLeft, Lock, UserPlus } from "lucide-react";
import { Icon } from "@/components/icons";
import { PanelImport } from "@/components/admin/panel-import";
import { canGrantRole } from "@/lib/users/role-authority";
import { userAdminFacts } from "@/server/authz/user-admin";
import { requireUser } from "@/server/session";
import { grantorFacts, panelOverview } from "@/server/users/roles";

export const metadata = { title: "Panels" };

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export default async function PanelsPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const actor = await requireUser();
  const { changed } = await searchParams;
  const [panels, facts] = await Promise.all([panelOverview(), userAdminFacts(actor.id)]);
  const canChangeChair = canGrantRole(grantorFacts(facts), "PANEL_CHAIR");

  return (
    <section className="rec-stack" aria-label="Panels">
      <p className="body rec-muted">
        Each panel reviews protocols from its disciplines. The Panel Chair receives the panel&apos;s chair tasks.
        {canChangeChair ? "" : " Only the REC Chair can change who chairs a panel."}
      </p>
      {changed ? (
        <p className="rec-banner" role="status">
          The Panel Chair was changed.
        </p>
      ) : null}
      {panels.length === 0 ? <p className="rec-empty body">No panels are set up yet.</p> : null}

      <div className="rec-panel-grid">
        {panels.map((panel) => (
          <section className="rec-card rec-panel-card" key={panel.id} aria-labelledby={`panel-${panel.id}`} data-inactive={!panel.active || undefined}>
            <header>
              <p className="code rec-muted">{panel.code}</p>
              <h2 className="heading" id={`panel-${panel.id}`}>
                {panel.name}
              </h2>
              {panel.active ? null : <p className="body-sm rec-muted">Inactive</p>}
            </header>

            <div className="rec-chair-slot">
              <p className="label">Panel Chair</p>
              {panel.chairs.length === 0 ? (
                <p className="body rec-muted">No chair assigned</p>
              ) : (
                panel.chairs.map((chair) => (
                  <Link key={chair.id} href={`/admin/users/${chair.userId}`} className="rec-chair-slot__person">
                    <span className="rec-avatar" aria-hidden="true">
                      {initials(chair.name)}
                    </span>
                    <span>
                      <span className="subheading">{chair.name}</span>
                      {chair.allPanels ? <span className="caption rec-muted"> · chairs all panels</span> : null}
                    </span>
                  </Link>
                ))
              )}
              {panel.active && canChangeChair ? (
                <Link href={`/admin/users/panels/${panel.id}/chair`} className="rec-btn rec-btn--secondary">
                  <Icon icon={panel.chairs.length > 0 ? ArrowRightLeft : UserPlus} />
                  <span>{panel.chairs.length > 0 ? "Change chair" : "Assign a chair"}</span>
                </Link>
              ) : panel.active ? (
                <p className="caption rec-muted rec-inline">
                  <Icon icon={Lock} size={14} /> REC Chair only
                </p>
              ) : null}
            </div>

            <div>
              <p className="label">Members ({panel.members.length})</p>
              {panel.members.length === 0 ? <p className="body-sm rec-muted">No one else holds a role on this panel.</p> : null}
              <ul className="rec-member-list">
                {panel.members.map((member) => (
                  <li key={member.id}>
                    <Link href={`/admin/users/${member.userId}`}>{member.name}</Link>
                    <span className="rec-role-chip">{member.roleName}</span>
                  </li>
                ))}
              </ul>
            </div>

            <details className="rec-disclosure">
              <summary className="body-sm">Disciplines ({panel.disciplines.length})</summary>
              <p className="body-sm">{panel.disciplines.length > 0 ? panel.disciplines.join(", ") : "None"}</p>
            </details>
          </section>
        ))}
      </div>

      {canChangeChair ? (
        <details className="rec-card rec-disclosure">
          <summary className="subheading">Import a panel list from a spreadsheet</summary>
          <PanelImport />
        </details>
      ) : null}
    </section>
  );
}
