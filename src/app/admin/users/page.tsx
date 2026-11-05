import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminMergeForm } from "@/components/account/merge-forms";
import { isBootstrapAdmin } from "@/server/auth/bootstrap";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata = { title: "Users" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; merged?: string }>;
}) {
  const actor = await requireUser();
  if (!(await isBootstrapAdmin(actor.id))) redirect("/app");
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const users = await prisma.user.findMany({
    where: {
      status: { not: "MERGED" },
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: "insensitive" } },
              { emails: { some: { email: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: { emails: { where: { isContact: true } } },
    orderBy: { displayName: "asc" },
    take: 50,
  });

  return (
    <article className="rec-stack">
      <h1 className="title">Users</h1>
      <p className="body rec-muted">
        REC Staff can merge two accounts here when someone has separate faculty and student identities. Conflicting roles on the same protocol stop the merge and name the protocol.
      </p>
      <p className="body-sm">
        <Link href="/admin/users/pending">Pending approval</Link>
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
      <AdminMergeForm
        users={users.map((user) => ({
          id: user.id,
          label: `${user.displayName} — ${user.emails[0]?.email ?? user.email ?? "no email"}`,
        }))}
      />
    </article>
  );
}
