import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { approveUserAction, rejectUserAction } from "@/server/auth/actions";
import { isBootstrapAdmin } from "@/server/auth/bootstrap";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata = { title: "Pending users" };

export default async function PendingUsersPage() {
  const actor = await requireUser();
  if (!(await isBootstrapAdmin(actor.id))) redirect("/app");
  const users = await prisma.user.findMany({
    where: { status: "PENDING_APPROVAL" },
    include: { emails: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <article className="rec-stack">
      <h1 className="title">Pending users</h1>
      <p className="body rec-muted">Accounts without a usc.edu.ph email wait here until REC Staff approves them.</p>
      {users.length === 0 ? <p className="body">No accounts are waiting.</p> : null}
      <table className="rec-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.displayName}</td>
              <td>{user.emails.map((email) => email.email).join(", ")}</td>
              <td>
                <div className="rec-actions">
                  <form action={approveUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <Button type="submit" variant="primary">
                      Approve
                    </Button>
                  </form>
                  <form action={rejectUserAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <Button type="submit" variant="danger">
                      Reject
                    </Button>
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}
