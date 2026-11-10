import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GrantRoleForm, RevokeRoleForm } from "@/components/admin/role-forms";
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import { formatManila } from "@/lib/time";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { userRoleDetail } from "@/server/users/roles";

export const metadata = { title: "Manage roles" };

const DONE: Record<string, string> = {
  granted: "The role was granted.",
  revoked: "The role was revoked.",
};

export default async function UserRolesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const actor = await requireUser();
  try {
    await authorize(actor, "users.manage");
  } catch {
    redirect("/app");
  }
  const { id } = await params;
  const { done } = await searchParams;
  const detail = await userRoleDetail(actor.id, id);
  if (!detail) notFound();
  const message = done ? DONE[done] : undefined;

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/users">Back to users</Link>
      </p>
      <h1 className="title">{detail.displayName}</h1>
      <div className="rec-actions">
        <span className="body">{detail.email ?? "No email"}</span>
        <UserStatusBadge status={detail.status} />
      </div>
      {message ? <p className="rec-banner">{message}</p> : null}

      <section className="rec-stack" aria-labelledby="current-roles">
        <h2 className="heading" id="current-roles">
          Current roles
        </h2>
        {detail.grants.length === 0 ? <p className="body">This person holds no committee role.</p> : null}
        {detail.grants.map((grant) => (
          <div className="rec-card rec-stack" key={grant.id}>
            <div>
              <h3 className="subheading">{grant.roleName}</h3>
              {grant.panelName ? <p className="body-sm">{grant.panelName}</p> : null}
              <p className="caption rec-muted">
                Granted {formatManila(grant.grantedAt, "d MMM yyyy")}
                {grant.grantedBy ? ` by ${grant.grantedBy}` : ""}
              </p>
            </div>
            {grant.canRevoke ? (
              <RevokeRoleForm userId={detail.id} userRoleId={grant.id} roleName={grant.roleName} />
            ) : (
              <p className="body-sm rec-muted">Only a System Admin can revoke this role.</p>
            )}
          </div>
        ))}
      </section>

      <section className="rec-stack" aria-labelledby="grant-role-heading">
        <h2 className="heading" id="grant-role-heading">
          Grant a role
        </h2>
        {detail.status !== "ACTIVE" ? (
          <p className="body">Only an active account can be given a role.</p>
        ) : detail.options.roles.length === 0 ? (
          <p className="body">No roles are set up yet. The operator needs to run the database seed.</p>
        ) : (
          <GrantRoleForm userId={detail.id} roles={detail.options.roles} panels={detail.options.panels} />
        )}
      </section>
    </article>
  );
}
