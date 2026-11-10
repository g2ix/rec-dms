import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminMergeForm } from "@/components/account/merge-forms";
import { UserStatusBadge } from "@/components/admin/user-status-badge";
import { authorize } from "@/server/authz";
import { canEditForms, canViewAudit } from "@/server/authz/policy";
import { userAdminFacts } from "@/server/authz/user-admin";
import { requireUser } from "@/server/session";
import { listUsersWithRoles } from "@/server/users/roles";

export const metadata = { title: "Users" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; merged?: string }>;
}) {
  const actor = await requireUser();
  try {
    await authorize(actor, "users.manage");
  } catch {
    redirect("/app");
  }
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const [users, facts] = await Promise.all([listUsersWithRoles(q), userAdminFacts(actor.id)]);
  const showForms = canEditForms(facts);
  const showAudit = canViewAudit(facts);

  return (
    <article className="rec-stack">
      <h1 className="title">Users</h1>
      <p className="body rec-muted">
        Open a person to grant or revoke a role. REC Staff can also merge two accounts when someone has separate faculty and student identities. Conflicting roles on the same protocol stop the merge and name the protocol.
      </p>
      <p className="body-sm">
        <Link href="/admin/users/pending">Pending approval</Link>
        {" · "}
        <Link href="/admin/panels">Panels</Link>
        {showForms ? (
          <>
            {" · "}
            <Link href="/admin/forms">Forms</Link>
          </>
        ) : null}
        {showAudit ? (
          <>
            {" · "}
            <Link href="/admin/audit">Audit log</Link>
          </>
        ) : null}
      </p>
      {query.merged ? <p className="rec-banner">The accounts were merged. The second account can no longer sign in.</p> : null}
      <form className="rec-actions" action="/admin/users">
        <label className="label" htmlFor="user-search">
          Search
        </label>
        <input id="user-search" name="q" className="rec-input" defaultValue={q} />
        <button className="rec-btn rec-btn--secondary" type="submit">
          <span>Search</span>
        </button>
      </form>
      {users.length === 0 ? (
        <p className="body">No accounts match that search.</p>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">Roles</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.displayName}</td>
                  <td>{user.email ?? "—"}</td>
                  <td>
                    <UserStatusBadge status={user.status} />
                  </td>
                  <td>{user.roles.length > 0 ? user.roles.join(", ") : "No committee role"}</td>
                  <td>
                    <Link href={`/admin/users/${user.id}`}>Manage roles</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 className="heading">Merge two accounts</h2>
      <AdminMergeForm
        users={users.map((user) => ({
          id: user.id,
          label: `${user.displayName} — ${user.email ?? "no email"}`,
        }))}
      />
    </article>
  );
}
