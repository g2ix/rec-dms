import { AdminMergeForm } from "@/components/account/merge-forms";
import { listUsersWithRoles } from "@/server/users/roles";

export const metadata = { title: "Merge accounts" };

export default async function MergeAccountsPage({ searchParams }: { searchParams: Promise<{ merged?: string }> }) {
  const { merged } = await searchParams;
  const users = await listUsersWithRoles("");
  return (
    <section className="rec-stack rec-narrow" aria-label="Merge accounts">
      <p className="body rec-muted">
        Use this when one person signed up twice, for example with a USC email and a personal Gmail. Their roles and protocols move to the
        account you keep, and the other account can no longer sign in. Conflicting roles on the same protocol stop the merge.
      </p>
      {merged ? <p className="rec-banner">The accounts were merged. The second account can no longer sign in.</p> : null}
      <div className="rec-card">
        <AdminMergeForm
          users={users.map((user) => ({
            id: user.id,
            label: `${user.displayName} — ${user.email ?? "no email"}`,
          }))}
        />
      </div>
    </section>
  );
}
