import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChangeChairForm } from "@/components/admin/role-forms";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { panelChairChoices } from "@/server/users/roles";

export const metadata = { title: "Change Panel Chair" };

export default async function ChangePanelChairPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireUser();
  try {
    await authorize(actor, "users.manage");
  } catch {
    redirect("/app");
  }
  const { id } = await params;
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const choices = await panelChairChoices(id, q);
  if (!choices || !choices.panel.active) notFound();
  const hasChair = choices.chairs.length > 0;

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/panels">Back to panels</Link>
      </p>
      <h1 className="title">{hasChair ? "Change Panel Chair" : "Assign Panel Chair"}</h1>
      <p className="code">{choices.panel.code}</p>
      <p className="body">{choices.panel.name}</p>
      <p className="body">
        <span className="label">Current chair: </span>
        {hasChair ? choices.chairs.join(", ") : "None"}
      </p>
      <p className="body-sm rec-muted">
        New chair tasks go to the new chair. Tasks already open stay with the person who holds them until REC Staff reassign them.
      </p>
      <form className="rec-actions" action={`/admin/panels/${id}/chair`}>
        <label className="label" htmlFor="chair-search">
          Search
        </label>
        <input id="chair-search" name="q" className="rec-input" defaultValue={q} />
        <button className="rec-btn rec-btn--secondary" type="submit">
          <span>Search</span>
        </button>
      </form>
      {choices.candidates.length === 0 ? <p className="body">No active accounts match that search.</p> : null}
      <ChangeChairForm panelId={id} candidates={choices.candidates} reasonRequired={hasChair} />
    </article>
  );
}
