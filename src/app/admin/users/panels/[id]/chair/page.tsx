import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { Icon } from "@/components/icons";
import { ChangeChairForm } from "@/components/admin/role-forms";
import { canGrantRole } from "@/lib/users/role-authority";
import { userAdminFacts } from "@/server/authz/user-admin";
import { requireUser } from "@/server/session";
import { grantorFacts, panelChairChoices } from "@/server/users/roles";

export const metadata = { title: "Change Panel Chair" };

export default async function ChangePanelChairPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireUser();
  if (!canGrantRole(grantorFacts(await userAdminFacts(actor.id)), "PANEL_CHAIR")) redirect("/admin/users/panels");
  const { id } = await params;
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const choices = await panelChairChoices(id, q);
  if (!choices || !choices.panel.active) notFound();
  const hasChair = choices.chairs.length > 0;

  return (
    <article className="rec-stack rec-narrow">
      <p className="body-sm">
        <Link href="/admin/users/panels" className="rec-back">
          <Icon icon={ArrowLeft} size={16} /> All panels
        </Link>
      </p>
      <header>
        <p className="code rec-muted">{choices.panel.code}</p>
        <h2 className="title">
          {hasChair ? "Change the chair of" : "Assign a chair to"} {choices.panel.name}
        </h2>
        <p className="body">
          <span className="label">Current chair: </span>
          {hasChair ? choices.chairs.join(", ") : "None"}
        </p>
      </header>

      <ol className="rec-steps-inline body-sm rec-muted">
        <li>Find the person</li>
        <li>Click them to select</li>
        <li>{hasChair ? "Give a reason and save" : "Save"}</li>
      </ol>

      <form className="rec-user-search" action={`/admin/users/panels/${id}/chair`} role="search">
        <label className="rec-visually-hidden" htmlFor="chair-search">
          Search people
        </label>
        <Icon icon={Search} size={18} />
        <input id="chair-search" name="q" className="rec-input" defaultValue={q} placeholder="Search by name or email" />
        <button className="rec-btn rec-btn--secondary" type="submit">
          <span>Search</span>
        </button>
      </form>

      {choices.candidates.length === 0 ? <p className="rec-empty body">No active accounts match that search.</p> : null}
      <ChangeChairForm panelId={id} panelName={choices.panel.name} candidates={choices.candidates} reasonRequired={hasChair} />
      <p className="body-sm rec-muted">
        New chair tasks go to the new chair. Tasks already open stay with whoever holds them until REC Staff reassign them.
      </p>
    </article>
  );
}
