import Link from "next/link";
import { notFound } from "next/navigation";
import { formatManila } from "@/lib/time";
import { AppError } from "@/server/errors";
import { pendingUserList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const user = await requireUser();
  try {
    const rows = await pendingUserList(user.id);
    return (
      <article className="rec-stack">
        <h1 className="title">Users</h1>
        <p className="body rec-muted">
          Accounts without a usc.edu.ph email wait here. REC Staff or a System Admin approves them on the{" "}
          <Link href="/admin/users/pending">pending users</Link> screen. Roles are on the{" "}
          <Link href="/admin/users">users</Link> screen, and Panel Chairs on the <Link href="/admin/panels">panels</Link> screen.
        </p>
        {rows.length === 0 ? <p className="body">No accounts are waiting.</p> : null}
        {rows.length > 0 ? (
          <div className="rec-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Waiting since</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.displayName}</td>
                    <td>{row.email ?? "—"}</td>
                    <td>{formatManila(row.createdAt, "d MMM yyyy")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
